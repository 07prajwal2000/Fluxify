import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { loadWorkflow } from "../src/graph";
import { failNext, resetSink } from "../src/workflow";
import {
	TRIGGER_TIMEOUT_MS,
	emit,
	fireInternal,
	publishTrigger,
	resetTriggers,
	triggerHarness,
	unpublishTrigger,
	waitForBatches,
	waitForHits,
} from "../src/trigger";

/**
 * Triggers over a real NATS.
 *
 * Every test here publishes real messages and waits for a real fetch to
 * coalesce them. That is deliberate: batching is entirely a property of how the
 * broker answers `fetch`, so a test that assembled the batch itself would pass
 * whatever the consumer did.
 */
const collect = await loadWorkflow("collect");
const notify = await loadWorkflow("notify");

beforeAll(triggerHarness, 180_000);
beforeEach(() => {
	resetSink();
	resetTriggers();
});

describe("the internal path", () => {
	it(
		"runs the workflow the message names, with the data it carried",
		async () => {
			await fireInternal(collect, { id: "one" });

			const [batch] = await waitForBatches(1);
			expect(batch).toMatchObject({
				triggerId: "internal",
				workflowId: "collect",
				source: "internal",
				events: [{ id: "one" }],
				ok: true,
			});
		},
		TRIGGER_TIMEOUT_MS,
	);

	it(
		"hands the graph an array even for a single event",
		async () => {
			await fireInternal(collect, { id: "solo" });

			const [hit] = await waitForHits("/collected", 1);
			expect(hit!.body).toMatchObject({ size: 1, ids: ["solo"] });
			// `input` is the unwrapped element, so a size-1 graph reads its payload
			// without indexing into the batch
			expect(hit!.body.input).toEqual({ id: "solo" });
		},
		TRIGGER_TIMEOUT_MS,
	);
});

describe("a batching trigger", () => {
	it(
		"coalesces several events into one run",
		async () => {
			await publishTrigger({
				triggerId: "t-batch",
				workflow: collect,
				batchSize: 5,
				maxWaitMs: 1_000,
			});
			await emit("t-batch", [
				{ id: "a" },
				{ id: "b" },
				{ id: "c" },
				{ id: "d" },
				{ id: "e" },
			]);

			const [batch] = await waitForBatches(1);
			expect(batch!.events).toHaveLength(5);

			const hits = await waitForHits("/collected", 1);
			// one run, not five
			expect(hits).toHaveLength(1);
			expect(hits[0]!.body).toMatchObject({
				size: 5,
				ids: ["a", "b", "c", "d", "e"],
			});
			await unpublishTrigger("t-batch");
		},
		TRIGGER_TIMEOUT_MS,
	);

	it(
		"runs anyway once maxWaitMs elapses, without waiting for a full batch",
		async () => {
			await publishTrigger({
				triggerId: "t-wait",
				workflow: collect,
				batchSize: 500,
				maxWaitMs: 500,
			});
			await emit("t-wait", [{ id: "x" }, { id: "y" }]);

			const [batch] = await waitForBatches(1);
			expect(batch!.events).toHaveLength(2);
			await unpublishTrigger("t-wait");
		},
		TRIGGER_TIMEOUT_MS,
	);

	it(
		"caps a batch by bytes before it caps it by count",
		async () => {
			await publishTrigger({
				triggerId: "t-bytes",
				workflow: collect,
				batchSize: 100,
				maxWaitMs: 1_000,
				// room for a couple of the payloads below, nowhere near a hundred
				maxBytes: 2_048,
			});
			const events = Array.from({ length: 20 }, (_, index) => ({
				id: `big-${index}`,
				blob: "x".repeat(512),
			}));
			await emit("t-bytes", events);

			const [batch] = await waitForBatches(1);
			expect(batch!.events.length).toBeLessThan(20);
			await unpublishTrigger("t-bytes");
		},
		TRIGGER_TIMEOUT_MS,
	);

	it(
		"behaves as a plain queue consumer at size 1",
		async () => {
			await publishTrigger({
				triggerId: "t-single",
				workflow: collect,
				batchSize: 1,
				maxWaitMs: 300,
			});
			await emit("t-single", [{ id: "1" }, { id: "2" }, { id: "3" }]);

			const batches = await waitForBatches(3);
			expect(batches.map((batch) => batch.events.length)).toEqual([1, 1, 1]);
			await unpublishTrigger("t-single");
		},
		TRIGGER_TIMEOUT_MS,
	);
});

describe("a failing batch", () => {
	it(
		"is retried whole rather than in part",
		async () => {
			await publishTrigger({
				triggerId: "t-fail",
				workflow: collect,
				batchSize: 3,
				maxWaitMs: 1_000,
			});
			// the first run's HTTP block fails, so the batch naks and comes back
			failNext("/collected", 1);
			await emit("t-fail", [{ id: "p" }, { id: "q" }, { id: "r" }]);

			const batches = await waitForBatches(2);
			expect(batches[0]!.ok).toBe(false);
			// redelivered as one unit: the same three events, not the survivors
			expect(batches[1]!.events).toEqual(batches[0]!.events);
			await unpublishTrigger("t-fail");
		},
		TRIGGER_TIMEOUT_MS,
	);
});

describe("a trigger's lifecycle", () => {
	it(
		"stops consuming when the trigger goes away, with no restart",
		async () => {
			await publishTrigger({
				triggerId: "t-gone",
				workflow: collect,
				batchSize: 1,
				maxWaitMs: 300,
			});
			await emit("t-gone", [{ id: "before" }]);
			await waitForBatches(1);

			await unpublishTrigger("t-gone");
			resetTriggers();
			await emit("t-gone", [{ id: "after" }]);

			// nothing is pulling it any more, so it sits on the stream
			await Bun.sleep(1_000);
			expect(await waitForBatches(0)).toEqual([]);
		},
		TRIGGER_TIMEOUT_MS,
	);
});

describe("a trigger linked to several workflows", () => {
	it(
		"starts each of them from one event",
		async () => {
			// One source read once, two graphs run. The jobs are independent, so
			// this is the difference between a link table and a second trigger.
			await publishTrigger({
				triggerId: "t-fanout",
				workflow: collect,
				alsoStarts: [notify],
			});

			await emit("t-fanout", [{ id: "fan", orderId: "A-9", status: "shipped" }]);

			const [collected] = await waitForHits("/collected", 1);
			expect(collected!.body).toMatchObject({ size: 1, ids: ["fan"] });
			const [notified] = await waitForHits("/notify", 1);
			expect(notified!.body).toMatchObject({ orderId: "A-9" });
		},
		TRIGGER_TIMEOUT_MS,
	);
});

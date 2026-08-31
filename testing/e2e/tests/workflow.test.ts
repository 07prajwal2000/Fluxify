import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { loadWorkflow } from "../src/graph";
import {
	WORKFLOW_TIMEOUT_MS,
	failNext,
	resetSink,
	runTarget,
	runWorkflow,
	unpublishWorkflow,
	workflowHarness,
} from "../src/workflow";

/**
 * Workflows, end to end over a real NATS.
 *
 * Every test here goes API-side publish -> JetStream -> worker -> compiled
 * graph, with the artifact arriving over a KV watch first. That transport is
 * the whole difference between a workflow and a route, and it is where the
 * failures actually happen: a consumer that never gets created, an artifact
 * that never lands, a failed run that is silently acked instead of retried.
 *
 * Each test runs under a 10s ceiling. The broker starts once in `beforeAll`,
 * outside that budget, because pulling and booting a container is not what any
 * of these are timing.
 */
const notify = await loadWorkflow("notify");
const triage = await loadWorkflow("triage");
const fanout = await loadWorkflow("fanout");
const rescue = await loadWorkflow("rescue");

beforeAll(workflowHarness, 180_000);
beforeEach(resetSink);

describe("a queued workflow", () => {
	it(
		"runs the graph and carries the job payload into it",
		async () => {
			const run = await runWorkflow(notify, {
				orderId: "A-1",
				status: "shipped",
			});

			expect(run.ok).toBe(true);
			// one delivery: nothing failed, so nothing was redelivered
			expect(run.attempts).toBe(1);
			expect(run.hits).toEqual([
				{ path: "/notify", body: { orderId: "A-1", text: "order A-1 is shipped" } },
			]);
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"takes the branch the payload asks for",
		async () => {
			const paged = await runWorkflow(triage, { severity: "critical" });
			expect(paged.hits.map((hit) => hit.path)).toEqual(["/page"]);

			resetSink();
			const logged = await runWorkflow(triage, { severity: "info" });
			// the run succeeds either way, so the path called is the only evidence
			// that the condition was evaluated rather than skipped
			expect(logged.hits.map((hit) => hit.path)).toEqual(["/log"]);
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"loops over the payload, one request per item",
		async () => {
			const run = await runWorkflow(fanout, {
				recipients: [{ email: "a@example.com" }, { email: "b@example.com" }],
			});

			expect(run.ok).toBe(true);
			expect(run.hits.map((hit) => hit.body.email)).toEqual([
				"a@example.com",
				"b@example.com",
			]);
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"does nothing at all for an empty list",
		async () => {
			const run = await runWorkflow(fanout, { recipients: [] });

			expect(run.ok).toBe(true);
			expect(run.hits).toEqual([]);
		},
		WORKFLOW_TIMEOUT_MS,
	);
});

describe("a workflow that fails", () => {
	it(
		"is redelivered until it succeeds",
		async () => {
			// the first two deliveries hit a sink that refuses; the graph throws,
			// the handler throws, and the broker brings the job back
			failNext("/notify", 2);

			const run = await runWorkflow(notify, { orderId: "A-2", status: "held" });

			expect(run.ok).toBe(true);
			expect(run.attempts).toBe(3);
			// three deliveries means the graph really ran three times, not that one
			// run was retried inside the block
			expect(run.hits).toHaveLength(3);
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"is dropped once the delivery budget is spent",
		async () => {
			failNext("/notify", 99);

			const run = await runWorkflow(notify, { orderId: "A-3", status: "held" });

			expect(run.ok).toBe(false);
			expect(run.attempts).toBe(3);
			expect(run.error).toContain("failed");
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"is acked, not retried, when its error handler ends on a terminal",
		async () => {
			const run = await runWorkflow(rescue, { orderId: "A-4" });

			// the handler settles the run as a normal result, so the queue has
			// nothing to retry — the alert going out is the only trace of it
			expect(run.ok).toBe(true);
			expect(run.attempts).toBe(1);
			expect(run.hits).toHaveLength(1);
			expect(run.hits[0]!.path).toBe("/alert");
			expect(run.hits[0]!.body.reason).toContain("payment gateway refused A-4");
		},
		WORKFLOW_TIMEOUT_MS,
	);
});

describe("a workflow this worker cannot run", () => {
	it(
		"acks a job whose workflow was never published",
		async () => {
			const run = await runTarget("no-such-workflow", {});

			// redelivering cannot make the artifact appear, so the job is dropped
			// rather than left circling the queue
			expect(run.ok).toBe(true);
			expect(run.attempts).toBe(1);
			expect(run.hits).toEqual([]);
		},
		WORKFLOW_TIMEOUT_MS,
	);

	it(
		"stops running a workflow once its artifact is deleted",
		async () => {
			await runWorkflow(notify, { orderId: "A-5", status: "shipped" });
			await unpublishWorkflow(notify);
			resetSink();

			const run = await runTarget(notify.name, {
				orderId: "A-6",
				status: "shipped",
			});

			// a deactivated workflow is dropped from KV; the queue keeps accepting
			// runs for it, and they have to go quiet rather than pile up
			expect(run.ok).toBe(true);
			expect(run.hits).toEqual([]);
		},
		WORKFLOW_TIMEOUT_MS,
	);
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import {
	applyRunStop,
	type RunStop,
	setRunStopClearer,
	StopLedger,
	STOP_TTL_MS,
	stopApplies,
	stopKey,
	trackRun,
} from "../runStops";
import type { JobEnvelope } from "../types";
import { runWorkflowJob } from "../workflowJob";

const PROJECT = "stops-spec";
const shared = globalThis as unknown as { stopSpec: { runs: number; signal?: AbortSignal } };
let cleared: Array<[string, number]>;
let next = 0;

function artifact(workflowId: string, source: string) {
	applyArtifactUpdate(`workflow.${PROJECT}.${workflowId}`, {
		workflowId,
		projectId: PROJECT,
		projectName: "p",
		name: "w",
		timeoutSeconds: 30,
		tracingEnabled: false,
		recordExecution: false,
		workflowVersion: "2026-01-01T00:00:00.000Z",
		source: `globalThis.stopSpec.runs++; globalThis.stopSpec.signal = ctx.signal; ${source}`,
		compiledAt: "2026-01-01T00:00:00.000Z",
	});
	return workflowId;
}

const OK = "return { successful: true, output: 1 };";
const AWAIT_STOP =
	"await new Promise((r) => ctx.signal.addEventListener('abort', r)); return { successful: true, output: 1 };";

function job(target: string, runKey?: string, firedAt = 1_000): JobEnvelope {
	return {
		id: crypto.randomUUID(),
		kind: "workflow",
		projectId: PROJECT,
		target,
		enqueuedAt: "2026-01-01T00:00:00.000Z",
		...(runKey ? { runKey, firedAt } : {}),
	};
}

function stop(runKey: string, stoppedAt: number, revision = 1): RunStop {
	return { key: stopKey(PROJECT, runKey), projectId: PROJECT, runKey, stoppedAt, revision };
}

const id = () => `run-${next++}`;

beforeEach(() => {
	shared.stopSpec = { runs: 0 };
	cleared = [];
	setRunStopClearer((key, revision) => cleared.push([key, revision]));
});
afterEach(() => setRunStopClearer());

describe("the time rule", () => {
	it("applies to a run fired before the stop, or in the same millisecond", () => {
		expect(stopApplies(999, stop("a", 1_000))).toBe(true);
		expect(stopApplies(1_000, stop("a", 1_000))).toBe(true);
	});

	it("does not apply to a run fired after it", () => {
		expect(stopApplies(1_001, stop("a", 1_000))).toBe(false);
	});
});

describe("a run a stop already reached", () => {
	it("is skipped, resolves, and clears the entry once", async () => {
		const wf = artifact("skip", OK);
		const key = id();
		applyRunStop(stop(key, 2_000, 7));

		await runWorkflowJob(job(wf, key, 1_000));

		expect(shared.stopSpec.runs).toBe(0);
		expect(cleared).toEqual([[stopKey(PROJECT, key), 7]]);
	});

	it("runs when fired after the stop, and leaves the older entry alone", async () => {
		const wf = artifact("reuse", OK);
		const key = id();
		applyRunStop(stop(key, 500));

		await runWorkflowJob(job(wf, key, 1_000));

		expect(shared.stopSpec.runs).toBe(1);
		expect(cleared).toEqual([]);
	});
});

describe("a stop during a run", () => {
	it("aborts it, and it resolves so the queue never retries", async () => {
		const wf = artifact("abort", AWAIT_STOP);
		const key = id();
		const running = runWorkflowJob(job(wf, key));
		await Bun.sleep(5);
		applyRunStop(stop(key, 2_000, 3));

		await running;

		expect(shared.stopSpec.signal?.aborted).toBe(true);
		expect(cleared).toEqual([[stopKey(PROJECT, key), 3]]);
	});

	it("turns a failure it arrived during into a stop", async () => {
		const wf = artifact(
			"fail",
			"await new Promise((r) => ctx.signal.addEventListener('abort', r)); throw new Error('boom');",
		);
		const key = id();
		const running = runWorkflowJob(job(wf, key));
		await Bun.sleep(5);
		applyRunStop(stop(key, 2_000));

		await expect(running).resolves.toBeUndefined();
	});

	it("turns an unsuccessful result it arrived during into a stop", async () => {
		const wf = artifact(
			"unsuccessful",
			"await new Promise((r) => ctx.signal.addEventListener('abort', r)); return { successful: false, error: 'x' };",
		);
		const key = id();
		const running = runWorkflowJob(job(wf, key));
		await Bun.sleep(5);
		applyRunStop(stop(key, 2_000));

		await expect(running).resolves.toBeUndefined();
	});

	it("aborts every earlier run with that id, but clears once", async () => {
		const wf = artifact("both", AWAIT_STOP);
		const key = id();
		const runs = [runWorkflowJob(job(wf, key)), runWorkflowJob(job(wf, key))];
		await Bun.sleep(5);
		applyRunStop(stop(key, 2_000));

		await Promise.all(runs);

		expect(cleared).toHaveLength(1);
	});

	it("does not abort a run fired after it", () => {
		const key = id();
		const run = trackRun(job("x", key, 3_000));
		applyRunStop(stop(key, 2_000));

		expect(run?.signal.aborted).toBe(false);
		run?.end();
		expect(cleared).toEqual([]);
	});

	it("does not clear a newer stop on the same id", () => {
		const key = id();
		const run = trackRun(job("x", key, 1_000));
		applyRunStop(stop(key, 2_000, 1));
		applyRunStop(stop(key, 3_000, 2));

		run?.end();

		expect(cleared).toEqual([]);
	});
});

describe("a run that no stop reached", () => {
	it("still fails, and asks for no cleanup", async () => {
		const wf = artifact("plain-fail", "throw new Error('boom');");

		await expect(runWorkflowJob(job(wf, id()))).rejects.toThrow("boom");

		expect(cleared).toEqual([]);
	});

	it("gets no stop tracking without a Run ID, only the timeout's signal", async () => {
		const wf = artifact("no-id", OK);

		expect(trackRun(job(wf))).toBeUndefined();
		await runWorkflowJob(job(wf));

		expect(shared.stopSpec.runs).toBe(1);
		expect(shared.stopSpec.signal?.aborted).toBe(false);
	});
});

describe("a stop with no run", () => {
	it("does nothing", () => {
		expect(() => applyRunStop(stop(id(), 2_000))).not.toThrow();
		expect(cleared).toEqual([]);
	});
});

describe("StopLedger", () => {
	it("keeps the latest entry per key and drops expired ones", () => {
		const ledger = new StopLedger();
		const now = Date.now();
		ledger.set(stop("old", now - STOP_TTL_MS - 1_000));
		ledger.set(stop("a", now, 1));
		ledger.set(stop("a", now, 2));

		expect(ledger.list().map((entry) => [entry.runKey, entry.revision])).toEqual([["a", 2]]);
	});
});

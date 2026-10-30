import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import type { WorkflowTrace } from "../../telemetry/routeRecorder";
import { applyRunStop, setRunStopClearer, stopKey } from "../runStops";
import { registerWorkflowJobHandler, runWorkflowJob } from "../workflowJob";

const PROJECT = "workflow-timeout-spec";
const TIMEOUT_SECONDS = 0.05;
const TIMEOUT_MS = TIMEOUT_SECONDS * 1000;

/** Waits for the abort, and fails like an aborted call. */
const HANGS = `
await new Promise((r) => ctx.signal.addEventListener('abort', r, { once: true }));
ctx.signal.throwIfAborted();`;
/** The same, but the run takes a while longer to wind down. */
const WINDS_DOWN = `
await new Promise((r) => ctx.signal.addEventListener('abort', r, { once: true }));
await Bun.sleep(${TIMEOUT_MS * 2});
ctx.signal.throwIfAborted();`;

afterEach(() => setRunStopClearer());

function run(source: string, runKey?: string, timeoutSeconds = TIMEOUT_SECONDS) {
	const workflowId = crypto.randomUUID();
	applyArtifactUpdate(`workflow.${PROJECT}.${workflowId}`, {
		workflowId,
		projectId: PROJECT,
		projectName: "p",
		name: "agent",
		timeoutSeconds,
		tracingEnabled: true,
		recordExecution: false,
		workflowVersion: "2026-01-01T00:00:00.000Z",
		source,
		compiledAt: "2026-01-01T00:00:00.000Z",
	});
	const outcomes: string[] = [];
	const trace: WorkflowTrace = {
		recordSpan() {},
		enterCustomBlock: () => ({ trace, close() {} }),
		complete: (outcome) => void outcomes.push(outcome),
	};
	registerWorkflowJobHandler({ start: () => trace });
	const attempt = () =>
		runWorkflowJob({
			id: crypto.randomUUID(),
			kind: "workflow",
			projectId: PROJECT,
			target: workflowId,
			enqueuedAt: "2026-01-01T00:00:00.000Z",
			...(runKey ? { runKey, firedAt: 1_000 } : {}),
		});
	return { attempt, outcomes };
}

const stop = (runKey: string) =>
	applyRunStop({
		key: stopKey(PROJECT, runKey),
		projectId: PROJECT,
		runKey,
		stoppedAt: 2_000,
		revision: 1,
	});

describe("the workflow timeout", () => {
	it("fails a run past it, naming the timeout, so the queue retries it", async () => {
		const { attempt, outcomes } = run(HANGS);
		const failure = await attempt().catch((error) => error);
		expect(failure.message).toBe(`workflow agent timed out after ${TIMEOUT_SECONDS} seconds`);
		expect(failure.cause.name).toBe("TimeoutError");
		expect(outcomes).toEqual(["failure"]);
	});

	it("gives each attempt the full budget", async () => {
		const key = crypto.randomUUID();
		const { attempt, outcomes } = run(`
globalThis[${JSON.stringify(key)}] = (globalThis[${JSON.stringify(key)}] ?? 0) + 1;
if (globalThis[${JSON.stringify(key)}] === 1) { ${HANGS} }
return { successful: true, output: ctx.signal.aborted };`);
		await expect(attempt()).rejects.toThrow("timed out");
		await attempt();
		expect(outcomes).toEqual(["failure", "success"]);
	});

	it("also names the timeout when the graph's own handling settled the failure", async () => {
		const { attempt, outcomes } = run(`${HANGS.replace("ctx.signal.throwIfAborted();", "")}
return { successful: false, error: ctx.signal.reason };`);
		await expect(attempt()).rejects.toThrow("timed out");
		expect(outcomes).toEqual(["failure"]);
	});

	it("leaves a run under it untouched", async () => {
		const { attempt, outcomes } = run(
			"if (ctx.signal.aborted) throw new Error('aborted'); return { successful: true };",
			undefined,
			30,
		);
		await attempt();
		expect(outcomes).toEqual(["success"]);
	});

	it("gives a run with no Run ID a signal too", async () => {
		const { attempt } = run("if (!ctx.signal) throw new Error('no signal'); return { successful: true };");
		await attempt();
	});

	it("keeps a run that finished past it a success: a retry would repeat finished work", async () => {
		const { attempt, outcomes } = run(`
await Bun.sleep(${TIMEOUT_MS * 2});
return { successful: true, output: ctx.signal.aborted };`);
		await attempt();
		expect(outcomes).toEqual(["success"]);
	});
});

describe("a timeout and a stop", () => {
	it("a stop is cancelled and not retried, under the timeout", async () => {
		const runKey = crypto.randomUUID();
		setRunStopClearer(() => {});
		const { attempt, outcomes } = run(HANGS, runKey, 30);
		const running = attempt();
		await Bun.sleep(5);
		stop(runKey);
		await running;
		expect(outcomes).toEqual(["cancelled"]);
	});

	it("a stop arriving after the timeout still wins, and is not retried", async () => {
		const runKey = crypto.randomUUID();
		const cleared: string[] = [];
		setRunStopClearer((key) => cleared.push(key));
		const { attempt, outcomes } = run(WINDS_DOWN, runKey);
		const running = attempt();
		await Bun.sleep(TIMEOUT_MS * 1.5);
		stop(runKey);
		await running;
		expect(outcomes).toEqual(["cancelled"]);
		expect(cleared).toEqual([stopKey(PROJECT, runKey)]);
	});

	it("a timeout arriving after a stop stays cancelled", async () => {
		const runKey = crypto.randomUUID();
		setRunStopClearer(() => {});
		const { attempt, outcomes } = run(WINDS_DOWN, runKey);
		const running = attempt();
		await Bun.sleep(5);
		stop(runKey);
		await running;
		expect(outcomes).toEqual(["cancelled"]);
	});

	it("a timed-out run clears no stop entry, and a stop between attempts skips the retry", async () => {
		const runKey = crypto.randomUUID();
		const cleared: string[] = [];
		setRunStopClearer((key) => cleared.push(key));
		const { attempt, outcomes } = run(HANGS, runKey);
		await expect(attempt()).rejects.toThrow("timed out");
		expect(cleared).toEqual([]);

		stop(runKey);
		await attempt();
		expect(outcomes).toEqual(["failure"]);
		expect(cleared).toEqual([stopKey(PROJECT, runKey)]);
	});
});

describe("a timed-out graph", () => {
	const block = (id: string, type: BlockTypes, data: object = {}) => ({
		id,
		type,
		data,
		position: { x: 0, y: 0 },
	});
	const edge = (from: string, to: string) => ({
		id: `${from}-${to}`,
		from,
		to,
		fromHandle: "source",
		toHandle: "source",
	});
	const mark = (id: string, key: string) =>
		block(id, BlockTypes.jsrunner, { value: `globalThis[${JSON.stringify(key)}].push("${id}"); return input;` });

	/** answers nothing, and says when a caller gave up */
	let gaveUp: () => void;
	const abandoned = new Promise<void>((resolve) => {
		gaveUp = resolve;
	});
	const server = Bun.serve({
		port: 0,
		idleTimeout: 0,
		fetch(request) {
			request.signal.addEventListener("abort", gaveUp);
			return new Promise<Response>(() => {});
		},
	});
	afterAll(() => server.stop(true));

	function graph(step: ReturnType<typeof block>) {
		const key = crypto.randomUUID();
		const log: string[] = [];
		(globalThis as any)[key] = log;
		const { source } = compileGraph(
			[
				block("in", BlockTypes.entrypoint),
				step,
				mark("after", key),
				block("eh", BlockTypes.errorHandler),
				mark("handled", key),
			] as never,
			[edge("in", step.id), edge(step.id, "after"), edge("eh", "handled")],
			{ asWorkflow: true },
		);
		return { log, ...run(source) };
	}

	it("aborts the I/O in flight, and neither the next block nor the error handler runs", async () => {
		const { attempt, log, outcomes } = graph(
			block("call", BlockTypes.httprequest, {
				url: server.url.href,
				method: "GET",
				headers: {},
				body: null,
			}),
		);
		await expect(attempt()).rejects.toThrow("timed out");
		await abandoned;
		expect(log).toEqual([]);
		expect(outcomes).toEqual(["failure"]);
	});

	it("stops at the next block after code with no I/O", async () => {
		const { attempt, log } = graph(
			block("busy", BlockTypes.jsrunner, {
				// a timer cannot fire during the loop, so the block yields once at the end
				value: `const end = Date.now() + ${TIMEOUT_MS * 2}; while (Date.now() < end); await Bun.sleep(1); return input;`,
			}),
		);
		await expect(attempt()).rejects.toThrow("timed out");
		expect(log).toEqual([]);
	});
});

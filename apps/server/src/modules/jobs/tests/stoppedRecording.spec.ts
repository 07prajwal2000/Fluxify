import { afterEach, expect, it } from "bun:test";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import { WorkflowTraceRecorder } from "../../telemetry/routeRecorder";
import { applyRunStop, setRunStopClearer, stopKey } from "../runStops";
import { registerWorkflowJobHandler, runWorkflowJob } from "../workflowJob";

const PROJECT = "stopped-recording-spec";
const SOURCE = `
ctx.trace.recordSpan({ blockId: 'b1', blockType: 'jsrunner', startedAt: 1, endedAt: 2, outcome: 'success', output: 'done' });
await new Promise((r) => ctx.signal.addEventListener('abort', r));
return { successful: true, output: 1 };`;

afterEach(() => setRunStopClearer());

function run(workflowId: string, recorded: TraceRunPayload[], runKey?: string) {
	applyArtifactUpdate(`workflow.${PROJECT}.${workflowId}`, {
		workflowId,
		projectId: PROJECT,
		projectName: "p",
		name: "w",
		timeoutSeconds: 30,
		tracingEnabled: true,
		recordExecution: false,
		workflowVersion: "2026-01-01T00:00:00.000Z",
		source: SOURCE,
		compiledAt: "2026-01-01T00:00:00.000Z",
	});
	registerWorkflowJobHandler({
		start: (workflow) =>
			new WorkflowTraceRecorder(workflow, (payload) => recorded.push(payload)),
	});
	return runWorkflowJob({
		id: crypto.randomUUID(),
		kind: "workflow",
		projectId: PROJECT,
		target: workflowId,
		enqueuedAt: "2026-01-01T00:00:00.000Z",
		...(runKey ? { runKey, firedAt: 1_000 } : {}),
	});
}

it("records a stopped run as cancelled, with the spans recorded up to the stop", async () => {
	setRunStopClearer(() => {});
	const recorded: TraceRunPayload[] = [];
	const running = run("stopped", recorded, "stopped-key");
	await Bun.sleep(5);
	applyRunStop({
		key: stopKey(PROJECT, "stopped-key"),
		projectId: PROJECT,
		runKey: "stopped-key",
		stoppedAt: 2_000,
		revision: 1,
	});

	await running;

	expect(recorded).toHaveLength(1);
	expect(recorded[0]).toMatchObject({
		outcome: "cancelled",
		spans: [{ blockId: "b1", outcome: "success", output: "done" }],
	});
});

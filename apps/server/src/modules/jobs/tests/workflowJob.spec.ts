import { describe, expect, it } from "bun:test";
import { applyArtifactUpdate } from "../../requestRouter/compiledRuntime";
import { registerWorkflowJobHandler, type WorkflowTraceFactory } from "../workflowJob";
import { runJob } from "../registry";
import type { WorkflowArtifact } from "../../compiler/artifacts";
import type { WorkflowTrace } from "../../telemetry/routeRecorder";

function createArtifact(overrides: Partial<WorkflowArtifact> = {}): WorkflowArtifact {
	return {
		workflowId: "wf-1",
		projectId: "proj-1",
		projectName: "Test Project",
		name: "Test Workflow",
		timeoutSeconds: 30,
		tracingEnabled: true,
		recordExecution: false,
		workflowVersion: "2026-01-01T00:00:00.000Z",
		source: "return { successful: true, output: 'done' };",
		compiledAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("registerWorkflowJobHandler telemetry", () => {
	it("starts and completes a trace when tracingEnabled is true", async () => {
		const artifact = createArtifact({
			source: "if (ctx.trace) { ctx.trace.recordSpan({ blockId: 'b1', blockType: 'entrypoint', input: input, output: 'ok', startedAt: 10, endedAt: 20, outcome: 'success' }); } return { successful: true, output: 'ok' };",
		});
		applyArtifactUpdate("workflow.wf-1", artifact);

		const started: any[] = [];
		const completed: string[] = [];
		const spans: any[] = [];

		const mockTrace: WorkflowTrace = {
			recordSpan(span) {
				spans.push(span);
			},
			enterCustomBlock() {
				return { trace: mockTrace, close: () => {} };
			},
			complete(outcome) {
				completed.push(outcome);
			},
		};

		const traceFactory: WorkflowTraceFactory = {
			start(workflow) {
				started.push(workflow);
				return mockTrace;
			},
		};

		registerWorkflowJobHandler(traceFactory);

		await runJob({
			id: "job-1",
			kind: "workflow",
			projectId: "proj-1",
			target: "wf-1",
			payload: { foo: "bar" },
			enqueuedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(started).toEqual([
			{
				workflowId: "wf-1",
				projectId: "proj-1",
				workflowVersion: "2026-01-01T00:00:00.000Z",
				workflowName: "Test Workflow",
			},
		]);
		expect(spans).toHaveLength(1);
		expect(spans[0].blockId).toBe("b1");
		expect(completed).toEqual(["success"]);
	});

	it("completes trace with failure when workflow returns unsuccessful", async () => {
		const artifact = createArtifact({
			workflowId: "wf-fail",
			source: "return { successful: false, error: 'something broke' };",
		});
		applyArtifactUpdate("workflow.wf-fail", artifact);

		const completed: string[] = [];
		const mockTrace: WorkflowTrace = {
			recordSpan() {},
			enterCustomBlock() {
				return { trace: mockTrace, close: () => {} };
			},
			complete(outcome) {
				completed.push(outcome);
			},
		};

		registerWorkflowJobHandler({
			start: () => mockTrace,
		});

		await expect(
			runJob({
				id: "job-2",
				kind: "workflow",
				projectId: "proj-1",
				target: "wf-fail",
				payload: null,
				enqueuedAt: "2026-01-01T00:00:00.000Z",
			}),
		).rejects.toThrow("something broke");

		expect(completed).toEqual(["failure"]);
	});

	it("completes trace with failure when workflow throws an exception", async () => {
		const artifact = createArtifact({
			workflowId: "wf-throw",
			source: "throw new Error('fatal graph crash');",
		});
		applyArtifactUpdate("workflow.wf-throw", artifact);

		const completed: string[] = [];
		const mockTrace: WorkflowTrace = {
			recordSpan() {},
			enterCustomBlock() {
				return { trace: mockTrace, close: () => {} };
			},
			complete(outcome) {
				completed.push(outcome);
			},
		};

		registerWorkflowJobHandler({
			start: () => mockTrace,
		});

		await expect(
			runJob({
				id: "job-3",
				kind: "workflow",
				projectId: "proj-1",
				target: "wf-throw",
				payload: null,
				enqueuedAt: "2026-01-01T00:00:00.000Z",
			}),
		).rejects.toThrow("fatal graph crash");

		expect(completed).toEqual(["failure"]);
	});

	it("does not start a trace when tracingEnabled is false", async () => {
		const artifact = createArtifact({
			workflowId: "wf-untraced",
			tracingEnabled: false,
			source: "return { successful: true, output: 'done' };",
		});
		applyArtifactUpdate("workflow.wf-untraced", artifact);

		let started = false;
		registerWorkflowJobHandler({
			start() {
				started = true;
				throw new Error("should not be called");
			},
		});

		await runJob({
			id: "job-4",
			kind: "workflow",
			projectId: "proj-1",
			target: "wf-untraced",
			payload: null,
			enqueuedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(started).toBe(false);
	});
});

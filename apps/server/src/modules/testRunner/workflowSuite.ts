import { instantiateCompiled } from "@fluxify/blocks";
import type { AssertionResult } from "../../db/schema";
import { WORKFLOW_JOB } from "../jobs/subjects";
import { readInput } from "../jobs/workflowJob";
import { createJobContext } from "../requestRouter/service";
import type { TriggerBatch } from "../triggers/types";
import { type CaseInfo, evaluateAssertions, type WorkflowOutcome } from "./assertions";
import { type CaseOutcome, runCases, type SuiteCase, toCases } from "./cases";
import { buildHooks } from "./hookRuntime";
import type { TestBootstrap, TestChildMessage, TestResult, WorkflowTarget } from "./types";

type WorkflowBootstrap = TestBootstrap & WorkflowTarget;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A workflow suite in the child (#487): read the input once, then run the
 * workflow per case with the suite's hooks and checks. The trigger is skipped —
 * the workflow starts the way an internal job does, with the case as its input.
 *
 * `loadInput` runs the script or loader block; `send` reports progress so the
 * supervisor restarts its watchdog per case.
 */
export async function runWorkflowSuite(
	boot: WorkflowBootstrap,
	setup: unknown,
	loadInput: () => Promise<unknown>,
	send: (message: TestChildMessage) => void,
): Promise<TestResult> {
	const startedAt = Date.now();
	try {
		const run = instantiateCompiled(boot.source);
		const value = boot.input.block ? await loadInput() : boot.input.raw;
		send({ type: "input-done" });
		const cases: SuiteCase[] =
			boot.input.mode === "cases" ? toCases(value) : [{ name: "Input", input: value }];

		const { cases: results, counts } = await runCases(
			cases,
			(item, index) => runCase(boot, run, { ...item, index }, setup),
			(result) => send({ type: "case-done", result }),
		);
		return {
			ok: true,
			cases: results,
			counts,
			durationMs: Date.now() - startedAt,
			verdict: { success: counts.passed === counts.total, result: [] },
		};
	} catch (error) {
		// the input could not be read or was not a valid list: nothing ran
		return { ok: false, error: messageOf(error), durationMs: Date.now() - startedAt };
	}
}

async function runCase(
	boot: WorkflowBootstrap,
	run: ReturnType<typeof instantiateCompiled>,
	item: CaseInfo,
	setup: unknown,
): Promise<CaseOutcome> {
	const id = `${boot.suiteRunId}:${item.index}`;
	// a batch like a trigger delivers, so `trigger.data` and `input` read as live
	const { events, input, meta, source } = readInput({
		id,
		kind: WORKFLOW_JOB,
		projectId: boot.projectId,
		target: boot.workflow.id,
		payload: toBatch(item.input),
		enqueuedAt: new Date().toISOString(),
	});
	const context = createJobContext({
		id,
		projectId: boot.projectId,
		target: boot.workflow.id,
		timeoutSeconds: boot.timeoutMs / 1000,
		trigger: { kind: "trigger", source, data: events, meta },
		payload: input,
	});
	const checks: AssertionResult[] = [];
	(context as { testHooks?: unknown }).testHooks = buildHooks(boot.hooks, {
		vars: context.vars,
		runId: boot.suiteRunId,
		setup,
		case: item,
		checks,
	});

	const startedAt = Date.now();
	let outcome: WorkflowOutcome;
	try {
		const result = await run(context, input);
		outcome =
			result?.successful === false
				? { successful: false, output: result.output, error: messageOf(result.error) }
				: { successful: true, output: result?.output };
	} catch (error) {
		outcome = { successful: false, output: undefined, error: messageOf(error) };
	} finally {
		context.dbFactory?.dispose();
	}
	const durationMs = Date.now() - startedAt;

	// a failed run is a failed check, not a suite error: `successful` is checkable
	const verdict = await evaluateAssertions(boot.assertions, {
		workflow: outcome,
		durationMs,
		setup,
		case: item,
	});
	return {
		// hook checks first: they ran first, inside the workflow
		status: verdict.success && checks.every((c) => c.success) ? "passed" : "failed",
		checks: [...checks, ...verdict.result],
		durationMs,
		output: outcome,
		error: outcome.error,
	};
}

/**
 * A case's input as the batch a trigger would deliver: a workflow's input is a
 * list of events, so `[d1, d2]` is two events (a bulk run) and `[d1]` one. A
 * value that is not a list is one event. A single event whose data is itself a
 * list is written `[[a, b]]`.
 */
export function toBatch(value: unknown): TriggerBatch {
	const receivedAt = new Date().toISOString();
	return {
		triggerId: "test",
		source: "internal",
		events: (Array.isArray(value) ? value : [value]).map((data, index) => ({
			data,
			meta: { id: String(index), receivedAt, source: "internal" },
		})),
	};
}

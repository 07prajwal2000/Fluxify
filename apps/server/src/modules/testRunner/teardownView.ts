import type { CaseResult } from "../../db/schema";
import type { WorkflowOutcome } from "./assertions";
import type { TestBootstrap, TestResult } from "./types";

/**
 * What the suite sent and got back, as teardown reads it in
 * `testsuite.request` / `testsuite.response` (#716) — so it can clean up by an id
 * that only the response holds.
 *
 * - route: the request as sent, and `{ status, headers, body }`. The response
 *   is `null` when the route errored or timed out: nothing came back.
 * - workflow, single input: `{ input }` and `{ successful, output, error }`.
 * - workflow, cases: the same per case, as lists in case order (cases that never
 *   finished are missing).
 */
export function teardownView(boot: TestBootstrap, result?: TestResult) {
	if (!boot.workflow) {
		const answered = result?.ok && !result.cases;
		return {
			request: boot.request,
			response: answered
				? { status: Number(result.status), headers: result.headers, body: result.data }
				: null,
		};
	}
	const cases = result?.cases ?? [];
	if (boot.input.mode === "cases") {
		return {
			request: cases.map(({ name, input }) => ({ name, input })),
			response: cases.map((c) => ({ name: c.name, ...responseOf(c) })),
		};
	}
	const [only] = cases;
	return {
		request: only ? { input: only.input } : null,
		response: only ? responseOf(only) : null,
	};
}

function responseOf({ output, error }: CaseResult) {
	const outcome = (output ?? {}) as Partial<WorkflowOutcome>;
	return { successful: outcome.successful, output: outcome.output, error: error ?? outcome.error };
}

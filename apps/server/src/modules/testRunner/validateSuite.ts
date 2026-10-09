import type { SuiteRunResult } from "../../db/schema";
import { type Lookup, notFound, pathParts } from "./actualValue";
import { type AssertionType, readPath, type WorkflowOutcome } from "./assertions";

/** what a run answered: the parts a check reads. A part left out is not checked. */
export type SuiteSample = {
	status?: number;
	headers?: Record<string, string>;
	body?: unknown;
	/** a workflow's output */
	output?: unknown;
};

const typeOf = (value: unknown) =>
	value === null ? "null" : Array.isArray(value) ? "a list" : typeof value;

const isBoolean = (value: unknown) =>
	typeof value === "boolean" || value === "true" || value === "false";

/**
 * Dry check (#716): does each check make sense against a response, without
 * running anything? It finds paths the response does not have and values of a
 * kind the operator cannot use. It does not judge the expected value: whether
 * the status is 200 is what a run is for. Custom JS is user code and not looked at.
 */
export function checkAssertions(assertions: AssertionType[], sample: SuiteSample) {
	const problems: string[] = [];
	let checked = 0;
	assertions.forEach((a, index) => {
		const problem = problemWith(a, sample);
		if (problem === null) return;
		checked++;
		if (problem) problems.push(`Check ${index + 1}, ${describe(a)}: ${problem}`);
	});
	return { checked, problems };
}

const describe = (a: AssertionType) =>
	a.propertyPath ? `${a.target}(${a.propertyPath})` : a.target;

/** undefined: fine; null: this sample cannot say; a string: what is wrong */
function problemWith(a: AssertionType, sample: SuiteSample): string | null | undefined {
	switch (a.target) {
		case "status":
			return sample.status === undefined ? null : isNumber(a);
		case "time":
			return isNumber(a);
		case "body":
		case "output": {
			if (!(a.target in sample)) return null;
			const root = sample[a.target];
			const parts = pathParts(a.propertyPath);
			return judge(a, readPath(root, a.propertyPath), { root, parts, label: a.target });
		}
		case "header": {
			if (!sample.headers) return null;
			const name = (a.propertyPath ?? "").toLowerCase();
			return judge(a, sample.headers[name], {
				root: sample.headers,
				parts: [name],
				label: "headers",
			});
		}
		default:
			return null;
	}
}

function isNumber(a: AssertionType) {
	const text = a.expectedValue ?? "";
	return text.trim() === "" || Number.isNaN(Number(text))
		? `expected value "${text}" is not a number`
		: undefined;
}

function judge(a: AssertionType, value: unknown, look: Lookup) {
	if (value === undefined) {
		// "not exists" is the one check that wants the property gone
		return a.operator === "not_exists" ? undefined : notFound(look);
	}
	if ((a.operator === "true" || a.operator === "false") && !isBoolean(value)) {
		return `the value is ${typeOf(value)}, not true or false`;
	}
	return undefined;
}

/**
 * A finished run as a sample: a route's answer, or the first workflow case that
 * got an output (a successful one first). A run that never got an answer (setup
 * failed, timed out) has none.
 */
export function sampleOfRun(result: SuiteRunResult): SuiteSample | undefined {
	if (result.statusCode !== undefined) {
		return { status: result.statusCode, headers: result.headers, body: result.actualData };
	}
	const answered = (result.cases ?? []).map(
		(c) => c.output as Partial<WorkflowOutcome> | undefined,
	);
	const run = answered.find((o) => o?.successful) ?? answered.find(Boolean);
	return run && { output: run.output };
}

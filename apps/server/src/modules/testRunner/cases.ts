import type { CaseCounts, CaseResult } from "../../db/schema";

/**
 * Data-driven cases (#486, #487): one suite, many inputs, the same checks on
 * each. Shared by every target — a target only supplies how to run one input.
 */

export const MAX_CASES = 100;

export type SuiteCase = { name: string; input: unknown };

/** what running one input produced; the loop adds index, name and input */
export type CaseOutcome = Omit<CaseResult, "index" | "name" | "input">;

/**
 * A raw list, or whatever a script or loader returned, as cases. An item shaped
 * `{ input, name? }` is a case; anything else is the input itself, so a script
 * can return plain values.
 */
export function toCases(value: unknown): SuiteCase[] {
	if (!Array.isArray(value)) {
		throw new Error("Cases must be a list; switch to Single input to send one value");
	}
	if (value.length > MAX_CASES) {
		throw new Error(`Too many cases: ${value.length} (the limit is ${MAX_CASES})`);
	}
	return value.map((item, index) => {
		const isCase = typeof item === "object" && item !== null && "input" in item;
		const name = isCase && typeof item.name === "string" && item.name.trim();
		return { name: name || `Case ${index + 1}`, input: isCase ? item.input : item };
	});
}

/**
 * Runs the cases one after another — they share the suite's setup, so running
 * them at once would let one case's writes race another's reads. A failing case
 * does not stop the rest: the stored counts are the point.
 */
export async function runCases(
	cases: SuiteCase[],
	runOne: (item: SuiteCase, index: number) => Promise<CaseOutcome>,
	onCase?: (result: CaseResult) => void,
) {
	const results: CaseResult[] = [];
	for (const [index, item] of cases.entries()) {
		const result = { index, name: item.name, input: item.input, ...(await runOne(item, index)) };
		results.push(result);
		onCase?.(result);
	}
	return { cases: results, counts: countCases(results) };
}

export function countCases(cases: Pick<CaseResult, "status">[]): CaseCounts {
	const counts: CaseCounts = { total: cases.length, passed: 0, failed: 0, error: 0, timeout: 0 };
	for (const { status } of cases) counts[status]++;
	return counts;
}

/**
 * How many times the target can run, for the admin's wait budget. A script or
 * loader's list is only known in the child, so it gets the cap.
 *
 * ponytail: a 100-case loader suite waits up to 100 × the workflow timeout for
 * a dead worker; report per-case progress over the bus if that bites.
 */
export function maxRuns(input?: { mode: string; raw?: unknown; block?: unknown }) {
	if (!input || input.mode === "single") return 1;
	if (input.block) return MAX_CASES;
	return Array.isArray(input.raw) ? Math.max(input.raw.length, 1) : 1;
}

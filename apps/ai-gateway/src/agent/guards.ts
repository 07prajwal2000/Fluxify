import type { Tool } from "ai";
import { isRead } from "./tools";

export const MAX_STEPS = 40;
export const TOKEN_BUDGET = 1_000_000;
export const MAX_RESULT_CHARS = 50_000;
/** The same call (or the same error) this many times gets a nudge; REPEAT_STOP times ends the run. */
export const REPEAT_NUDGE = 3;
export const REPEAT_STOP = 5;
/** Canvas results are never cut: a partial canvas leads to broken edits. */
const NEVER_CUT = new Set(["get_canvas", "edit_canvas"]);

export const WRAP_UP =
	"Note: you have used 80% of this run's token budget. Wrap up: finish the current change, check it, and summarize.";

const tokenText = (n: number) =>
	n >= 1_000_000
		? `${+(n / 1_000_000).toFixed(1)}M`
		: n >= 1000
			? `${Math.round(n / 1000)}k`
			: `${n}`;

/** What the model is told each step, so it can scope its work (it is never stored or cached). */
export const budgetLine = (step: number, maxSteps: number, used: number, maxTokens: number) =>
	`Budget: step ${step}/${maxSteps}, ${tokenText(used)}/${tokenText(maxTokens)} tokens used`;

/** A step or token limit that was reached. */
export type Limit = { kind: "steps" | "tokens"; used: number; limit: number };
/** Why a run ended early. */
export type Stop = Limit | { kind: "repeat"; tool: string };

/** What the terminal shows after `[stopped] `. */
export const stopMessage = (s: Stop) =>
	s.kind === "repeat"
		? `repeated ${s.tool} ${REPEAT_STOP} times`
		: s.kind === "steps"
			? `reached the ${s.limit}-step limit`
			: `reached the ${s.limit}-token budget (${s.used} used)`;

/** The history note, so the next turn knows why the reply ended. */
export const stopNote = (s: Stop) =>
	s.kind === "repeat"
		? `(stopped: repeated ${s.tool} ${REPEAT_STOP} times without progress; change approach or ask the user)`
		: s.kind === "steps"
			? `(stopped: reached the ${s.limit}-step limit before finishing)`
			: `(stopped: used ${s.used} of the ${s.limit}-token budget before finishing)`;

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` match. */
export const stableKey = (v: unknown) =>
	JSON.stringify(v, (_, x) =>
		x && typeof x === "object" && !Array.isArray(x)
			? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: x,
	) ?? "";

/** Keeps the start and the end of a long result, with a marker in the middle. */
export function capResult(name: string, out: unknown, max: number) {
	if (NEVER_CUT.has(name)) return out;
	const s = typeof out === "string" ? out : (JSON.stringify(out) ?? "");
	if (s.length <= max) return out;
	const half = Math.floor(max / 2);
	return `${s.slice(0, half)}\n\n[… ${s.length - 2 * half} chars cut. Narrow the request: filters, ids, a smaller page …]\n\n${s.slice(-half)}`;
}

const withNotes = (out: unknown, notes: string[]) => {
	if (!notes.length) return out;
	const note = notes.join("\n");
	return typeof out === "string" ? `${out}\n\n${note}` : { result: out, note };
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const snippet = (v: unknown) => (typeof v === "string" ? v : stableKey(v)).slice(0, 120);

/**
 * What one tool call achieved. `progress` resets the repeat counts; a `failure`
 * is counted by tool + `why`; reads are `neutral` unless they fail.
 * - call_route: status < 400 is progress, >= 400 a failure.
 * - Other writes: progress unless edit_canvas returned issues or a test run has failing cases.
 * - Any thrown error is a failure.
 */
export type Outcome = { kind: "progress" | "neutral" } | { kind: "failure"; why: string };
export function outcome(name: string, input: any, out: any, error?: unknown): Outcome {
	if (error !== undefined) return { kind: "failure", why: errorText(error) };
	if (name === "call_route") {
		const status = Number(out?.status);
		return status >= 400
			? { kind: "failure", why: `${input?.routeId} status ${status} ${snippet(out?.body)}` }
			: { kind: "progress" };
	}
	if (isRead(name)) return { kind: "neutral" };
	if (name === "edit_canvas" && out?.issues?.length)
		return { kind: "failure", why: String(out.issues[0].message) };
	if (name === "run_test_suite") {
		if (out?.status === "running") return { kind: "neutral" };
		if (out?.failedCount > 0) return { kind: "failure", why: `${out.failedCount} failing cases` };
	}
	return { kind: "progress" };
}

/** Per-run guard state: call counts, the repeat that stops the run, notes for the next result. */
export type Guard = { counts: Map<string, number>; repeat?: string; pending: string[] };
export const newGuard = (): Guard => ({ counts: new Map(), pending: [] });

/**
 * Every tool result goes through here: it is capped at `maxChars`, and calls
 * without progress are counted by two signatures (same tool and args; same
 * tool and same failure). A count of REPEAT_NUDGE gets a nudge, REPEAT_STOP
 * marks the run to stop; any progress resets all counts. Pending notes (the
 * token warning) ride on the next result.
 */
export function guardTools(
	tools: Record<string, Tool>,
	guard: Guard,
	maxChars: number,
): Record<string, Tool> {
	const seen = (sig: string) => {
		const n = (guard.counts.get(sig) ?? 0) + 1;
		guard.counts.set(sig, n);
		return n;
	};
	/** Counts the call and returns the notes for its result. */
	const notes = (name: string, input: unknown, o: Outcome) => {
		const out = guard.pending.splice(0);
		if (o.kind === "progress") {
			guard.counts.clear();
			return out;
		}
		const same = seen(`${name} ${stableKey(input)}`);
		const n = o.kind === "failure" ? Math.max(same, seen(`${name} failed: ${o.why}`)) : same;
		if (n >= REPEAT_STOP) guard.repeat ??= name;
		if (n >= REPEAT_NUDGE) {
			const what =
				o.kind === "failure" ? `failed with: ${snippet(o.why)}` : `args: ${snippet(input)}`;
			out.push(
				`Note: you made this ${name} call (${what}) ${n} times without progress. You are looping: change approach, or stop and ask the user.`,
			);
		}
		return out;
	};
	return Object.fromEntries(
		Object.entries(tools).map(([name, t]) => {
			const execute = t.execute;
			if (!execute) return [name, t];
			const run = async (input: unknown, opts: Parameters<typeof execute>[1]) => {
				let out: unknown;
				try {
					out = await execute(input, opts);
				} catch (e) {
					const all = notes(name, input, outcome(name, input, undefined, e));
					throw all.length ? new Error(`${errorText(e)}\n\n${all.join("\n")}`) : e;
				}
				const all = notes(name, input, outcome(name, input, out));
				return withNotes(capResult(name, out, maxChars), all);
			};
			return [name, { ...t, execute: run } as Tool];
		}),
	);
}

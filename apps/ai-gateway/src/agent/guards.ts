import type { Tool } from "ai";

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

/** Per-run guard state: call counts, the repeat that stops the run, notes for the next result. */
export type Guard = { counts: Map<string, number>; repeat?: string; pending: string[] };
export const newGuard = (): Guard => ({ counts: new Map(), pending: [] });

/**
 * Every tool result goes through here: it is capped at `maxChars`, and a call
 * repeated (same tool and args, or same tool and same error) gets a nudge at
 * REPEAT_NUDGE and marks the run to stop at REPEAT_STOP. Pending notes (the
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
	const notes = (name: string, n: number) => {
		if (n >= REPEAT_STOP) guard.repeat ??= name;
		const out = guard.pending.splice(0);
		if (n >= REPEAT_NUDGE)
			out.push(
				`Note: you made this ${name} call (or got this error) ${n} times. You are looping: change approach, or stop and ask the user.`,
			);
		return out;
	};
	return Object.fromEntries(
		Object.entries(tools).map(([name, t]) => {
			const execute = t.execute;
			if (!execute) return [name, t];
			const run = async (input: unknown, opts: Parameters<typeof execute>[1]) => {
				const n = seen(`${name} ${stableKey(input)}`);
				let out: unknown;
				try {
					out = await execute(input, opts);
				} catch (e) {
					const msg = errorText(e);
					const all = notes(name, Math.max(n, seen(`${name} failed: ${msg}`)));
					throw all.length ? new Error(`${msg}\n\n${all.join("\n")}`) : e;
				}
				return withNotes(capResult(name, out, maxChars), notes(name, n));
			};
			return [name, { ...t, execute: run } as Tool];
		}),
	);
}

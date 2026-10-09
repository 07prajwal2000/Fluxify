import type { LanguageModel, ModelMessage, Tool } from "ai";
import { type Compaction, estimate, type SummaryCompaction } from "./compactStats";
import { KEEP_STEPS, keepFrom, summarize } from "./summary";
import { keepSet, type TrimLevel, trimOld } from "./trim";

export {
	type Compaction,
	compactionLine,
	compactionText,
	estimate,
	type SummaryCompaction,
} from "./compactStats";
export { canCompact, SUMMARY_HEAD, summarize } from "./summary";
export { trimOld } from "./trim";

/** Context window when nothing else says (AGENT_MAX_CONTEXT_TOKENS in the CLI). */
export const MAX_CONTEXT_TOKENS = 128_000;
/** Over this share of the window, old tool results are shortened when the request is built. */
export const TRIM_AT = 0.6;
/** A trim batch goes on to the next class of results until the history is under this share. */
const TRIM_TO = 0.5;
/** Over this share, the older turns are replaced by one summary. */
export const SUMMARY_AT = 0.8;

type Usage = { inputTokens?: number; outputTokens?: number } | undefined;

/**
 * The check before each step: over 80% swaps a summary into `history`. Over
 * 60% the old tool results are trimmed in a batch: everything before the last
 * few steps, once, the least useful class first. That cut-off, the class and
 * what is kept then stay put, so the trimmed prefix is identical on every step
 * (the provider can cache it) until usage falls under 60% and crosses it
 * again. A failed summary falls back to a batch. What happened lands in
 * `events` for the stream to show.
 */
export function compactor(o: {
	model: Exclude<LanguageModel, string>;
	history: ModelMessage[];
	instructions: string;
	context?: number;
	/** Reads the canvases to re-attach to a summary (get_canvas). */
	tools?: Record<string, Tool>;
	abortSignal?: AbortSignal;
	/** The summary call starts (true) and ends (false): the slow part, which clients show as "Compacting…". */
	onCompacting?: (on: boolean) => void;
	/** A trim batch ran (its line is saved with the next step's message). */
	onTrim?: (event: Extract<Compaction, { kind: "trim" }>) => void;
	/** Told before the summary is swapped in; a throw keeps the history as it was. */
	onSummary?: (
		summary: ModelMessage,
		covered: ModelMessage[],
		event: SummaryCompaction,
	) => Promise<void>;
}) {
	const context = o.context ?? MAX_CONTEXT_TOKENS;
	const events: Compaction[] = [];
	/** The frozen trim: results before `cut` are trimmed, `level` says how far, `keep` which stay. */
	let cut = 0;
	let level: TrimLevel = 1;
	let keep = new Set<string>();
	/** A batch may run. Off after one until usage is seen under 60%. */
	let armed = true;
	/** The last step's usage no longer matches the history after a summary. */
	let stale = false;
	const trimmed = () => trimOld(o.history, cut, { keep, level });
	const batch = () => {
		cut = Math.max(0, keepFrom(o.history, KEEP_STEPS));
		keep = keepSet(o.history);
		armed = false;
		// the first class alone, if that is enough
		level = 0;
		let t = trimmed();
		if (estimate(t.messages, o.instructions) >= TRIM_TO * context) {
			level = 1;
			t = trimmed();
		}
		if (!t.results) return;
		const event = {
			type: "compaction" as const,
			kind: "trim" as const,
			results: t.results,
			tools: t.tools,
			before: estimate(o.history, o.instructions),
			after: estimate(t.messages, o.instructions),
		};
		events.push(event);
		o.onTrim?.(event);
	};
	const next = async (last: Usage) => {
		let used =
			last?.inputTokens && !stale
				? last.inputTokens + (last.outputTokens ?? 0)
				: estimate(o.history, o.instructions);
		stale = false;
		if (used >= SUMMARY_AT * context) {
			o.onCompacting?.(true);
			try {
				const r = await summarize(o.model, o.history, o);
				if (r) {
					await o.onSummary?.(r.messages[0], o.history.slice(0, r.event.coversUpTo), r.event);
					o.history.splice(0, o.history.length, ...r.messages);
					events.push(r.event);
					stale = true;
					cut = 0;
					keep = new Set();
					armed = true;
					used = estimate(o.history, o.instructions);
				}
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				events.push({ type: "compaction", kind: "summary-failed", error });
				armed = true;
			} finally {
				o.onCompacting?.(false);
			}
		}
		if (used < TRIM_AT * context) armed = true;
		else if (armed) batch();
		return cut ? trimmed().messages : [...o.history];
	};
	return { next, events };
}

import type { ModelMessage } from "ai";

/** What a compaction did; rides the event stream so the CLI and the web chat can show it. */
export type Compaction =
	| {
			type: "compaction";
			kind: "trim";
			results: number;
			/** Trimmed results per tool, e.g. { get_recording: 3 }. */
			tools: Record<string, number>;
			before: number;
			after: number;
	  }
	| {
			type: "compaction";
			kind: "summary";
			messages: number;
			/** Messages [0, coversUpTo) of the history are covered by the summary. */
			coversUpTo: number;
			before: number;
			after: number;
	  }
	| { type: "compaction"; kind: "summary-failed"; error: string };

export type SummaryCompaction = Extract<Compaction, { kind: "summary" }>;

export const chars = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).length;
/** Rough token count: 4 chars a token. */
export const estimate = (messages: ModelMessage[], instructions = "") =>
	Math.ceil((chars(messages) + instructions.length) / 4);

export const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

const SHOWN_TOOLS = 4;
/** "get_recording ×3, get_system_logs ×4": the most trimmed tools first. */
const breakdown = (tools: Record<string, number>) => {
	const all = Object.entries(tools).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
	const shown = all.slice(0, SHOWN_TOOLS).map(([name, n]) => `${name} ×${n}`);
	return all.length > SHOWN_TOOLS ? [...shown, `+${all.length - SHOWN_TOOLS} more`] : shown;
};

/** The line for a compaction, in the web chat (also saved summary rows) and, with a prefix, the CLI. */
export const compactionText = (c: Compaction) =>
	c.kind === "trim"
		? `Trimmed ${c.results} old tool results (${breakdown(c.tools).join(", ")}), ${k(c.before)} → ${k(c.after)} tokens`
		: c.kind === "summary"
			? `Summarized ${c.messages} messages, ${k(c.before)} → ${k(c.after)} tokens`
			: `Compaction failed: ${c.error}`;

/** The line the CLI prints for a compaction. */
export const compactionLine = (c: Compaction) =>
	c.kind === "summary-failed"
		? `[compacted] summary failed (${c.error}), trimming old tool results instead`
		: `[compacted] ${compactionText(c)}`;

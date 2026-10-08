import { generateText, type LanguageModel, type ModelMessage } from "ai";

/** Context window when nothing else says (AGENT_MAX_CONTEXT_TOKENS in the CLI). */
export const MAX_CONTEXT_TOKENS = 128_000;
/** Over this share of the window, old tool results are shortened when the request is built. */
export const TRIM_AT = 0.6;
/** Over this share, the older turns are replaced by one summary. */
export const SUMMARY_AT = 0.8;
/** The last steps (assistant turns) always go out verbatim. */
const KEEP_STEPS = 3;
/** Shorter results are not worth a stub. */
const MIN_TRIM_CHARS = 500;
const CANVAS = new Set(["get_canvas", "edit_canvas"]);
export const SUMMARY_HEAD = "Summary of the earlier conversation:\n";

/** What a compaction did; rides the event stream so the CLI (and later the UI) can show it. */
export type Compaction =
	| { type: "compaction"; kind: "trim"; results: number; savedTokens: number }
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

const chars = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).length;
/** Rough token count: 4 chars a token. */
export const estimate = (messages: ModelMessage[], instructions = "") =>
	Math.ceil((chars(messages) + instructions.length) / 4);

/** Index of the first message of the last `n` steps, or -1 when there are fewer. */
const keepFrom = (messages: ModelMessage[], n: number) => {
	for (let i = messages.length - 1, seen = 0; i >= 0; i--)
		if (messages[i].role === "assistant" && ++seen === n) return i;
	return -1;
};

/**
 * 60%: a copy of `messages` with big tool results older than the last few
 * steps replaced by a stub. The latest canvas result stays. Same input, same
 * output; `messages` is not changed.
 */
export function trimOld(messages: ModelMessage[]) {
	const from = Math.max(0, keepFrom(messages, KEEP_STEPS));
	let lastCanvas = "";
	for (const m of messages)
		if (m.role === "tool")
			for (const p of m.content)
				if (p.type === "tool-result" && CANVAS.has(p.toolName)) lastCanvas = p.toolCallId;
	let results = 0;
	let saved = 0;
	const out = messages.map((m, i): ModelMessage => {
		if (m.role !== "tool" || i >= from) return m;
		return {
			...m,
			content: m.content.map((p) => {
				if (p.type !== "tool-result" || p.toolCallId === lastCanvas) return p;
				const n = chars(p.output);
				if (n < MIN_TRIM_CHARS) return p;
				const value = `[result trimmed: ${p.toolName}, ${n} chars]`;
				results++;
				saved += n - value.length;
				return { ...p, output: { type: "text" as const, value } };
			}),
		};
	});
	return { messages: out, results, savedTokens: Math.round(saved / 4) };
}

const SUMMARY_PROMPT = `You compact a conversation between a user and the Fluxify agent. Write a short summary another agent can continue from:
- Goal: what the user wants.
- Decisions made.
- Ids of everything created or changed (routes, workflows, blocks, suites, ...).
- Current state: what works, what was checked.
- Open problems and next steps.
Plain text, no preamble.`;

const MAX_PART = 1500;
const clip = (v: unknown) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > MAX_PART ? `${s.slice(0, MAX_PART)}…` : s;
};
/** The covered messages as plain text, so the summary call needs no tools. */
const transcript = (messages: ModelMessage[]) =>
	messages
		.map((m) => {
			if (typeof m.content === "string") return `${m.role}: ${clip(m.content)}`;
			const parts = (m.content as any[]).map((p) =>
				p.type === "text" || p.type === "reasoning"
					? clip(p.text)
					: p.type === "tool-call"
						? `call ${p.toolName} ${clip(p.input)}`
						: p.type === "tool-result"
							? `result ${p.toolName}: ${clip(p.output?.value ?? p.output)}`
							: `[${p.type}]`,
			);
			return `${m.role}: ${parts.join("\n")}`;
		})
		.join("\n\n");

/**
 * 80%: summarizes everything before the last user message and the last few
 * steps after it. Returns the new history: [summary, last user message,
 * recent steps], or null when there is too little to cover. Throws when the
 * summary call fails.
 */
export async function summarize(
	model: Exclude<LanguageModel, string>,
	messages: ModelMessage[],
	opts: { instructions?: string; abortSignal?: AbortSignal } = {},
) {
	const user = messages.findLastIndex((m) => m.role === "user");
	if (user < 0) return null;
	const cut = Math.max(user, keepFrom(messages.slice(user + 1), KEEP_STEPS) + user + 1);
	if (cut < 2) return null;
	const covered = messages.slice(0, cut);
	const { text } = await generateText({
		model,
		instructions: SUMMARY_PROMPT,
		messages: [{ role: "user", content: transcript(covered) }],
		abortSignal: opts.abortSignal,
	});
	if (!text.trim()) throw new Error("the model returned an empty summary");
	const summary: ModelMessage = { role: "user", content: SUMMARY_HEAD + text.trim() };
	const next = [summary, ...(cut > user ? [messages[user]] : []), ...messages.slice(cut)];
	const event: Compaction = {
		type: "compaction",
		kind: "summary",
		messages: covered.length,
		coversUpTo: cut,
		before: estimate(messages, opts.instructions),
		after: estimate(next, opts.instructions),
	};
	return { messages: next, event };
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
/** The line the CLI prints for a compaction. */
export const compactionLine = (c: Compaction) =>
	c.kind === "trim"
		? `[compacted] trimmed ${c.results} old tool results (−${k(c.savedTokens)} tokens)`
		: c.kind === "summary"
			? `[compacted] summarized ${c.messages} messages: ${k(c.before)} → ${k(c.after)} tokens`
			: `[compacted] summary failed (${c.error}), trimming old tool results instead`;

type Usage = { inputTokens?: number; outputTokens?: number } | undefined;

/**
 * The check before each step: over 80% swaps a summary into `history`, over
 * 60% (sticky, so the request does not flip between steps) sends a trimmed
 * copy. A failed summary falls back to the trim. What happened lands in
 * `events` for the stream to show.
 */
export function compactor(o: {
	model: Exclude<LanguageModel, string>;
	history: ModelMessage[];
	instructions: string;
	context?: number;
	abortSignal?: AbortSignal;
}) {
	const context = o.context ?? MAX_CONTEXT_TOKENS;
	const events: Compaction[] = [];
	let trimming = false;
	let reported = 0;
	/** The last step's usage no longer matches the history after a summary. */
	let stale = false;
	const next = async (last: Usage) => {
		const used =
			last?.inputTokens && !stale
				? last.inputTokens + (last.outputTokens ?? 0)
				: estimate(o.history, o.instructions);
		stale = false;
		if (used >= SUMMARY_AT * context) {
			try {
				const r = await summarize(o.model, o.history, o);
				if (r) {
					o.history.splice(0, o.history.length, ...r.messages);
					events.push(r.event);
					stale = true;
					reported = 0;
				}
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				events.push({ type: "compaction", kind: "summary-failed", error });
				trimming = true;
			}
		}
		if (!trimming && used < TRIM_AT * context) return [...o.history];
		trimming = true;
		const t = trimOld(o.history);
		// Once per phase: a line every step would be noise.
		if (t.results && !reported) {
			events.push({
				type: "compaction",
				kind: "trim",
				results: t.results,
				savedTokens: t.savedTokens,
			});
			reported = t.results;
		}
		return t.messages;
	};
	return { next, events };
}

import { generateText, type LanguageModel, type ModelMessage, type Tool } from "ai";
import { estimate, type SummaryCompaction } from "./compactStats";
import { compactionSpan, telemetryFor } from "./telemetry";

/** The last steps (assistant turns) always go out verbatim. */
export const KEEP_STEPS = 3;
export const SUMMARY_HEAD = "Summary of the earlier conversation:\n";
/** Where a summary's re-attached canvases start; the summarizer gets fresh ones instead. */
const CANVAS_HEAD = "\n\nCanvases being edited";
const CANVAS_MARK = /^\[canvas (route|workflow|custom_block) (\S+)\]$/gm;

/** Index of the first message of the last `n` steps, or -1 when there are fewer. */
export const keepFrom = (messages: ModelMessage[], n: number) => {
	for (let i = messages.length - 1, seen = 0; i >= 0; i--)
		if (messages[i].role === "assistant" && ++seen === n) return i;
	return -1;
};

const SUMMARY_PROMPT = `You compact a conversation between a user and the Fluxify agent. Write a short summary another agent can continue from:
- Goal: what the user wants.
- Decisions made.
- Ids of everything created or changed (routes, workflows, blocks, suites, ...).
- Current state: what works, what was checked.
- Open problems and next steps.
Exact shapes, copied word for word, never paraphrased (tests and edits are written from them):
- Every response body and error body a route returned, with its status code, and the exact error messages and header names seen.
- For each canvas being edited: its block keys (response_1), their types, the handles used and the edges (if_1.true → db_insert_1).
- For each test suite: its id and what it asserts (status, body fields, exact messages).
Plain text, no preamble.`;
/** What the user asked the summary to keep (/compact <text>), added to the prompt. */
const keepPrompt = (keep?: string) =>
	keep?.trim()
		? `

The user asks you to keep: ${keep.trim()}`
		: "";

const MAX_PART = 1500;
/** What the summary is written from: route answers, test suites and their results, errors, an earlier summary. */
const MAX_EXACT = 8000;
const EXACT = new Set([
	"call_route",
	"run_test_suite",
	"get_test_runs",
	"get_test_suite",
	"save_test_suite",
]);
const clip = (v: unknown, max = MAX_PART) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > max ? `${s.slice(0, max)}…` : s;
};
const isError = (o: any) => o?.type === "error-text" || o?.type === "error-json";

/** The covered messages as plain text, so the summary call needs no tools. */
const transcript = (messages: ModelMessage[]) =>
	messages
		.map((m) => {
			if (typeof m.content === "string") {
				if (!m.content.startsWith(SUMMARY_HEAD)) return `${m.role}: ${clip(m.content)}`;
				const [earlier] = m.content.split(CANVAS_HEAD);
				return `${m.role}: ${clip(earlier, MAX_EXACT)}`;
			}
			const parts = (m.content as any[]).map((p) =>
				p.type === "text" || p.type === "reasoning"
					? clip(p.text)
					: p.type === "tool-call"
						? `call ${p.toolName} ${clip(p.input, EXACT.has(p.toolName) ? MAX_EXACT : MAX_PART)}`
						: p.type === "tool-result"
							? `result ${p.toolName}: ${clip(p.output?.value ?? p.output, EXACT.has(p.toolName) || isError(p.output) ? MAX_EXACT : MAX_PART)}`
							: `[${p.type}]`,
			);
			return `${m.role}: ${parts.join("\n")}`;
		})
		.join("\n\n");

/** Where a summary stops covering, or null when there is too little to cover. */
function summaryCut(messages: ModelMessage[]) {
	const user = messages.findLastIndex((m) => m.role === "user");
	if (user < 0) return null;
	const cut = Math.max(user, keepFrom(messages.slice(user + 1), KEEP_STEPS) + user + 1);
	return cut < 2 ? null : { user, cut };
}

/** Would a summary of `messages` cover anything? (/compact says so before it starts a job.) */
export const canCompact = (messages: ModelMessage[]) => summaryCut(messages) !== null;

type Target = { kind: string; id: string };

/** Canvases edited in `messages` (edit_canvas calls), and those an earlier summary re-attached. */
function editedTargets(messages: ModelMessage[]) {
	const found = new Map<string, Target>();
	const add = (t?: Target) => t?.kind && t.id && found.set(`${t.kind} ${t.id}`, t);
	for (const m of messages) {
		if (typeof m.content === "string") {
			if (m.role === "user" && m.content.startsWith(SUMMARY_HEAD))
				for (const [, kind, id] of m.content.matchAll(CANVAS_MARK)) add({ kind, id });
			continue;
		}
		for (const p of m.content)
			if (p.type === "tool-call" && p.toolName === "edit_canvas") add((p.input as any)?.target);
	}
	return [...found.values()];
}

const MAX_CANVAS = 8000;
/**
 * The compact canvas (get_canvas compact: true) of every edited target, for the
 * end of the summary: block keys then come from the canvas, not from the summary
 * text. A canvas that can no longer be read (deleted since) is left out.
 */
async function canvasSection(
	tools: Record<string, Tool>,
	targets: Target[],
	abortSignal?: AbortSignal,
) {
	const get = tools.get_canvas?.execute;
	const parts: string[] = [];
	for (const [i, target] of targets.entries()) {
		if (!get) break;
		try {
			const out = await get(
				{ target, compact: true },
				{ toolCallId: `compact-${i}`, messages: [], abortSignal, context: undefined },
			);
			parts.push(`[canvas ${target.kind} ${target.id}]\n${clip(out, MAX_CANVAS)}`);
		} catch {}
	}
	return parts.length
		? `${CANVAS_HEAD} (get_canvas compact, as of this summary; block keys come from here. Read a canvas again for its version before you edit it):\n${parts.join("\n")}`
		: "";
}

/**
 * 80%: summarizes everything before the last user message and the last few
 * steps after it. Returns the new history: [summary, last user message,
 * recent steps], or null when there is too little to cover. Throws when the
 * summary call fails. `instructions` is the agent's system prompt (it counts
 * toward the size); `keep` is what the user asked the summary to keep; `tools`
 * (when given) re-attach the compact canvas of every edited target to the summary.
 * A summary is one compaction span (#719), with the token counts when it ends.
 */
export const summarize = (...args: Parameters<typeof summarizeNow>) =>
	compactionSpan(
		"summary",
		() => summarizeNow(...args),
		(r) =>
			r
				? {
						"fluxify.compaction.tokens_before": r.event.before,
						"fluxify.compaction.tokens_after": r.event.after,
						"fluxify.compaction.messages": r.event.messages,
					}
				: { "fluxify.compaction.skipped": true },
	);

async function summarizeNow(
	model: Exclude<LanguageModel, string>,
	messages: ModelMessage[],
	opts: {
		instructions?: string;
		keep?: string;
		tools?: Record<string, Tool>;
		abortSignal?: AbortSignal;
	} = {},
) {
	const at = summaryCut(messages);
	if (!at) return null;
	const { user, cut } = at;
	const covered = messages.slice(0, cut);
	const { text } = await generateText({
		model,
		instructions: SUMMARY_PROMPT + keepPrompt(opts.keep),
		messages: [{ role: "user", content: transcript(covered) }],
		abortSignal: opts.abortSignal,
		telemetry: telemetryFor("fluxify.agent.compaction"),
	});
	if (!text.trim()) throw new Error("the model returned an empty summary");
	const canvases = opts.tools
		? await canvasSection(opts.tools, editedTargets(covered), opts.abortSignal)
		: "";
	const summary: ModelMessage = { role: "user", content: SUMMARY_HEAD + text.trim() + canvases };
	const next = [summary, ...(cut > user ? [messages[user]] : []), ...messages.slice(cut)];
	const event: SummaryCompaction = {
		type: "compaction",
		kind: "summary",
		messages: covered.length,
		coversUpTo: cut,
		before: estimate(messages, opts.instructions),
		after: estimate(next, opts.instructions),
	};
	return { messages: next, event };
}

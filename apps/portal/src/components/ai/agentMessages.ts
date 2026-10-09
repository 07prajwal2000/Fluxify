import type { Compaction } from "@fluxify/ai-gateway/src/agent/compact";
import type { AgentEvent, ToolStatus } from "@fluxify/ai-gateway/src/agent/runner/events";
import { produce } from "immer";
import type { AgentRow } from "@/services/agentConversations";

export type ToolPart = {
	type: "tool";
	id: string;
	name: string;
	/** Human name from the server; use `toolTitle`, which falls back to the prettified name. */
	title?: string;
	input: unknown;
	output?: unknown;
	error?: string;
	/** How it ended; none while it runs or waits. */
	status?: ToolStatus;
	/** An approval event came for it. */
	approval?: boolean;
	startedAt?: number;
	endedAt?: number;
};
/** "save_route" → "Save route" when the server sent no title. */
export const toolTitle = (t: { name: string; title?: string }) =>
	t.title || t.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Result = Pick<ToolPart, "output" | "error" | "status" | "endedAt">;

/** A thought. `startedAt` is set while it streams live; `ms` once it ended (live, or worked out from the saved rows). */
export type ReasoningPart = { type: "reasoning"; text: string; startedAt?: number; ms?: number };
export type Part = { type: "text"; text: string } | ReasoningPart | ToolPart;
/**
 * What the chat renders: a user message, one assistant step, or a compaction line
 * (live from an event, or a saved summary row), keyed by its agent_messages seq.
 * The seq is not unique across roles: a trim line shares the seq of the step it came before.
 */
export type ChatMessage = {
	seq: number;
	role: "user" | "assistant" | "compaction";
	parts: Part[];
	/** compaction: what it did; missing on summary rows saved before the stats were kept. */
	compaction?: Compaction;
	/** compaction: the saved summary, to read. */
	summary?: string;
};
/** React key of a chat message. */
export const messageKey = (m: ChatMessage) => `${m.role}-${m.seq}`;
export type EndEvent = Extract<AgentEvent, { type: "done" | "error" }>;
/** A run as the stream shows it before its messages are reloaded. */
export type Live = {
	messages: ChatMessage[];
	lastEventAt: number;
	end?: EndEvent;
	/** When the model call in progress began: the last tool result came in. Unset until the first one. */
	callStartedAt?: number;
	/** Results of calls saved before this run began (an approved or rejected one); they ride on the saved row. */
	results: Record<string, Result>;
	/** A summary is being written: the status says "Compacting…" instead of the thinking timer. */
	compacting?: boolean;
};

export const EMPTY_LIVE: Live = { messages: [], lastEventAt: 0, results: {} };

type SavedPart = {
	type: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
	output?: { type: string; value?: unknown; reason?: string };
};

const partsOf = (content: unknown): SavedPart[] => {
	const c = (content as { content?: unknown } | null)?.content;
	return typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
};

/** A result that says it failed: an `error`, or an HTTP status of 400 and up (call_route). */
const failed = (v: unknown) => {
	const o = v as { status?: unknown; error?: unknown } | null;
	return typeof o === "object" && o !== null && (Boolean(o.error) || Number(o.status) >= 400);
};

const resultOf = (o: SavedPart["output"]): Result => {
	if (!o) return {};
	if (o.type === "execution-denied")
		return { error: o.reason ?? "Not approved", status: "rejected" };
	if (o.type.startsWith("error"))
		return {
			error: typeof o.value === "string" ? o.value : JSON.stringify(o.value),
			status: "error",
		};
	return { output: o.value, status: failed(o.value) ? "error" : "done" };
};

/**
 * A step that only thought and called tools took the time since the row before it, which is
 * its thinking. With a text answer in it that time is mixed, so it shows none.
 */
function thoughtTime(msg: ChatMessage, row: AgentRow, prev?: AgentRow) {
	const thoughts = msg.parts.filter((p): p is ReasoningPart => p.type === "reasoning");
	if (thoughts.length !== 1 || msg.parts.some((p) => p.type === "text")) return;
	const ms = Date.parse(row.createdAt ?? "") - Date.parse(prev?.createdAt ?? "");
	if (Number.isFinite(ms) && ms >= 0) thoughts[0].ms = ms;
}

/** Saved rows as chat messages: a tool result joins its call; a summary row is a compaction line; tool rows render nothing. */
export function toMessages(rows: AgentRow[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	const calls = new Map<string, ToolPart>();
	for (const [i, row] of rows.entries()) {
		const parts = partsOf(row.content);
		if (row.role === "summary") {
			const stats = (row.content as { compaction?: Compaction } | null)?.compaction;
			out.push({
				seq: row.seq,
				role: "compaction",
				parts: [],
				compaction: stats,
				summary: parts.map((p) => p.text ?? "").join(""),
			});
			continue;
		}
		if (row.role === "tool") {
			for (const p of parts) {
				const call = p.type === "tool-result" && calls.get(p.toolCallId ?? "");
				if (call) Object.assign(call, resultOf(p.output));
			}
			continue;
		}
		if (row.role !== "user" && row.role !== "assistant") continue;
		const msg: ChatMessage = { seq: row.seq, role: row.role, parts: [] };
		for (const p of parts) {
			if (p.type === "text" || p.type === "reasoning")
				msg.parts.push({ type: p.type, text: p.text ?? "" });
			else if (p.type === "tool-call") {
				const tool: ToolPart = {
					type: "tool",
					id: p.toolCallId ?? "",
					name: p.toolName ?? "",
					input: p.input,
				};
				calls.set(tool.id, tool);
				msg.parts.push(tool);
			}
		}
		if (row.role === "assistant") thoughtTime(msg, row, rows[i - 1]);
		out.push(msg);
	}
	return out;
}

const findTool = (messages: ChatMessage[], id: string) => {
	for (const m of messages) for (const p of m.parts) if (p.type === "tool" && p.id === id) return p;
};

/** Thoughts that were streaming stop here, except in step `streamingSeq`. */
const endThoughts = (messages: ChatMessage[], now: number, streamingSeq = -1) => {
	for (const m of messages)
		if (m.seq !== streamingSeq)
			for (const p of m.parts)
				if (p.type === "reasoning" && p.startedAt !== undefined && p.ms === undefined)
					p.ms = now - p.startedAt;
};

/**
 * One stream event applied to the live run. Every model call times its own
 * thinking: a thought runs from its first token to the next event that is not
 * its own, and `callStartedAt` restarts when a tool result comes in.
 */
export const applyEvent = (live: Live, e: AgentEvent, now = Date.now()): Live =>
	produce(live, (d) => {
		d.lastEventAt = now;
		endThoughts(d.messages, now, e.type === "reasoning" ? e.seq : -1);
		if (e.type === "done" || e.type === "error") {
			d.end = e;
			return;
		}
		if (e.type === "compacting") {
			d.compacting = e.on;
			return;
		}
		if (e.type === "compaction") {
			d.messages.push({ seq: e.seq, role: "compaction", parts: [], compaction: e.compaction });
			return;
		}
		const known = "toolCallId" in e ? findTool(d.messages, e.toolCallId) : undefined;
		if (e.type === "tool-end") {
			d.callStartedAt = now;
			if (!known) {
				d.results[e.toolCallId] = {
					status: e.status,
					endedAt: now,
					...(e.error !== undefined ? { error: e.error } : { output: e.output }),
				};
				return;
			}
			known.endedAt = now;
			known.status = e.status;
			if (e.error !== undefined) known.error = e.error;
			else known.output = e.output;
			return;
		}
		if (e.type === "approval" && known) {
			known.approval = true;
			known.title ??= e.toolTitle;
			return;
		}
		const step = (m: ChatMessage) => m.role === "assistant" && m.seq === e.seq;
		if (!d.messages.some(step)) d.messages.push({ seq: e.seq, role: "assistant", parts: [] });
		const parts = (d.messages.find(step) as ChatMessage).parts;
		const last = parts.at(-1);
		if (e.type === "text" || e.type === "reasoning") {
			if (last?.type === e.type) last.text += e.text;
			else
				parts.push(
					e.type === "reasoning"
						? { type: "reasoning", text: e.text, startedAt: now }
						: { type: "text", text: e.text },
				);
			return;
		}
		if (e.type !== "tool-start" && e.type !== "approval") return;
		parts.push({
			type: "tool",
			id: e.toolCallId,
			name: e.toolName,
			title: e.toolTitle,
			input: e.input,
			...(e.type === "approval" ? { approval: true } : { startedAt: now }),
		});
	});

/**
 * Saved messages, then the message just sent until a saved user row after
 * `pending.afterSeq` replaces it, then live messages past the last saved seq
 * (a reload that already has them wins).
 */
export function chatView(
	rows: AgentRow[],
	live: Live,
	pending: { text: string; afterSeq: number } | null,
): ChatMessage[] {
	const top = rows.at(-1)?.seq ?? -1;
	const out = toMessages(rows);
	if (pending && !rows.some((r) => r.role === "user" && r.seq > pending.afterSeq))
		out.push({
			seq: pending.afterSeq + 1,
			role: "user",
			parts: [{ type: "text", text: pending.text }],
		});
	for (const m of out)
		for (const p of m.parts)
			if (p.type === "tool" && p.status === undefined && live.results[p.id])
				Object.assign(p, live.results[p.id]);
	out.push(...live.messages.filter((m) => m.seq > top));
	return out;
}

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

export type Part = { type: "text"; text: string } | { type: "reasoning"; text: string } | ToolPart;
/** What the chat renders: a user message or one assistant step, keyed by its agent_messages seq. */
export type ChatMessage = { seq: number; role: "user" | "assistant"; parts: Part[] };
export type EndEvent = Extract<AgentEvent, { type: "done" | "error" }>;
/** A run as the stream shows it before its messages are reloaded. */
export type Live = {
	messages: ChatMessage[];
	lastEventAt: number;
	end?: EndEvent;
	/** Results of calls saved before this run began (an approved or rejected one); they ride on the saved row. */
	results: Record<string, Result>;
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

/** Saved rows as chat messages: a tool result joins its call; summaries and tool rows render nothing. */
export function toMessages(rows: AgentRow[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	const calls = new Map<string, ToolPart>();
	for (const row of rows) {
		const parts = partsOf(row.content);
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
		out.push(msg);
	}
	return out;
}

const findTool = (messages: ChatMessage[], id: string) => {
	for (const m of messages) for (const p of m.parts) if (p.type === "tool" && p.id === id) return p;
};

/** One stream event applied to the live run. */
export const applyEvent = (live: Live, e: AgentEvent, now = Date.now()): Live =>
	produce(live, (d) => {
		d.lastEventAt = now;
		if (e.type === "done" || e.type === "error") {
			d.end = e;
			return;
		}
		if (e.type === "compaction") return;
		const known = "toolCallId" in e ? findTool(d.messages, e.toolCallId) : undefined;
		if (e.type === "tool-end") {
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
		if (!d.messages.some((m) => m.seq === e.seq))
			d.messages.push({ seq: e.seq, role: "assistant", parts: [] });
		const parts = (d.messages.find((m) => m.seq === e.seq) as ChatMessage).parts;
		const last = parts.at(-1);
		if (e.type === "text" || e.type === "reasoning") {
			if (last?.type === e.type) last.text += e.text;
			else parts.push({ type: e.type, text: e.text } as Part);
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

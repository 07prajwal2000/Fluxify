import type { ToolResultPart } from "ai";
import type { runAgent, StopReason } from "../agent";
import type { Compaction } from "../compact";
import type { Part } from "../progress";
import type { AgentStore, RunStatus } from "../store";
import { isDelete, titleOf } from "../tools";

/**
 * What a client sees of a run while it streams. `seq` is the agent_messages
 * seq of the message the event belongs to, once that message is saved: a
 * client that already loaded seq N from Postgres skips events with seq <= N.
 * `done` and `error` end the stream and are never skipped.
 */
export type AgentEvent =
	| { type: "text" | "reasoning"; seq: number; text: string }
	| {
			type: "tool-start";
			seq: number;
			toolCallId: string;
			toolName: string;
			toolTitle: string;
			input: unknown;
	  }
	| {
			type: "tool-end";
			seq: number;
			toolCallId: string;
			toolName: string;
			status: ToolStatus;
			output?: unknown;
			error?: string;
	  }
	| {
			type: "approval";
			seq: number;
			toolCallId: string;
			toolName: string;
			toolTitle: string;
			input: unknown;
			isDelete: boolean;
	  }
	| { type: "compaction"; seq: number; compaction: Compaction }
	| { type: "done"; seq: number; status: RunStatus; reason?: StopReason }
	| { type: "error"; seq: number; message: string };

/** How a call ended: its result, a failure (a throw, or a result that says it failed), or the user's no. */
export type ToolStatus = "done" | "error" | "rejected";

/** A result that reports its own failure: an `error`, or an HTTP `status` of 400 and up (call_route). */
export const outputFailed = (output: unknown) => {
	const o = output as { status?: unknown; error?: unknown } | null;
	return typeof o === "object" && o !== null && (Boolean(o.error) || Number(o.status) >= 400);
};

export const isEnd = (e: AgentEvent) => e.type === "done" || e.type === "error";

/** The events a client that holds every message up to `afterSeq` still needs. */
export const unseen = (events: AgentEvent[], afterSeq: number) =>
	events.filter((e) => isEnd(e) || e.seq > afterSeq);

/** Live previews only: the full value is in the saved message. Keeps a batch far under the NATS payload cap. */
const MAX_PREVIEW = 4000;
const clip = (v: unknown) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}…` : v;
};

/**
 * Collects events and publishes them as one batch every `ms`. Text and
 * reasoning deltas of the same message merge into one event. Batches go out
 * in order; a failed publish is reported and the run goes on (the messages
 * are in Postgres either way).
 */
export function batcher(
	publish: (events: AgentEvent[]) => Promise<void>,
	onError: (e: unknown) => void,
	ms = 100,
) {
	let buf: AgentEvent[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let chain = Promise.resolve();
	const flush = () => {
		clearTimeout(timer);
		timer = undefined;
		if (buf.length) {
			const out = buf;
			buf = [];
			chain = chain.then(() => publish(out)).catch(onError);
		}
		return chain;
	};
	const push = (e: AgentEvent) => {
		const last = buf.at(-1);
		if (
			last &&
			(last.type === "text" || last.type === "reasoning") &&
			last.type === e.type &&
			last.seq === e.seq
		)
			last.text += e.text;
		else buf.push(e);
		timer ??= setTimeout(flush, ms);
	};
	return { push, flush };
}

/**
 * Tracks the seq the next saved message gets: the store is wrapped so every
 * append moves it. A step starts only after the previous one is saved (the SDK
 * awaits onStepEnd, which awaits the save), so at `start-step` the step's
 * assistant message gets `next` and its tool results `next + 1`.
 */
export function seqTracker(store: AgentStore) {
	const t = { next: 0, step: 0 };
	const saw = (seqs: number[]) => {
		if (seqs.length) t.next = Math.max(t.next, (seqs.at(-1) as number) + 1);
		return seqs;
	};
	const tracked: AgentStore = {
		...store,
		append: async (...a) => saw(await store.append(...a)),
		appendSummary: async (...a) => saw([await store.appendSummary(...a)])[0],
	};
	return { t, store: tracked };
}

/** One stream part as an event, or nothing for parts a client does not need. */
export function toEvent(part: Part, t: { next: number; step: number }): AgentEvent | undefined {
	switch (part.type) {
		case "start-step":
			t.step = t.next;
			return;
		case "text-delta":
			return { type: "text", seq: t.step, text: part.text };
		case "reasoning-delta":
			return part.text ? { type: "reasoning", seq: t.step, text: part.text } : undefined;
		case "tool-call":
			return {
				type: "tool-start",
				seq: t.step,
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				toolTitle: titleOf(part.toolName),
				input: clip(part.input),
			};
		case "tool-result":
		case "tool-error":
			return {
				type: "tool-end",
				seq: t.step + 1,
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				...(part.type === "tool-error"
					? {
							status: "error",
							error: String(part.error instanceof Error ? part.error.message : part.error),
						}
					: {
							status: outputFailed(part.output) ? "error" : "done",
							output: clip(part.output),
						}),
			};
		case "tool-output-denied":
			return {
				type: "tool-end",
				seq: t.step + 1,
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				status: "rejected",
			};
		case "tool-approval-request": {
			const call = part.toolCall;
			return {
				type: "approval",
				seq: t.step,
				toolCallId: call.toolCallId,
				toolName: call.toolName,
				toolTitle: titleOf(call.toolName),
				input: call.input,
				isDelete: isDelete(call.toolName),
			};
		}
	}
}

/** The end of a call that ran outside the stream: an approved call's result, or a rejection, saved before the loop starts. */
export function decidedEvent(r: ToolResultPart, seq: number): AgentEvent {
	const base = { type: "tool-end", seq, toolCallId: r.toolCallId, toolName: r.toolName } as const;
	const o = r.output;
	if (o.type === "execution-denied") return { ...base, status: "rejected" };
	if (o.type === "error-text" || o.type === "error-json")
		return {
			...base,
			status: "error",
			error: typeof o.value === "string" ? o.value : JSON.stringify(o.value),
		};
	const output = clip(o.type === "text" || o.type === "json" ? o.value : undefined);
	return { ...base, status: outputFailed(output) ? "error" : "done", output };
}

/** A summary is saved as its own row (the last one); a trim saves nothing. */
export const compactionEvent = (c: Compaction, t: { next: number }): AgentEvent => ({
	type: "compaction",
	seq: c.kind === "summary" ? t.next - 1 : t.next,
	compaction: c,
});

/** Turns the run's stream into events; compactions show before the step they shrank. */
export async function pump(
	result: ReturnType<typeof runAgent>,
	t: { next: number; step: number },
	push: (e: AgentEvent) => void,
) {
	for await (const part of result.stream) {
		for (const c of result.compactions.splice(0)) push(compactionEvent(c, t));
		const e = toEvent(part, t);
		if (e) push(e);
	}
}

import type { ModelMessage, ToolCallPart, ToolResultPart } from "ai";
import { type Approval, rejected, runAgent } from "./agent";
import type { Compaction } from "./compact";
import { guardTools, MAX_RESULT_CHARS, newGuard } from "./guards";
import type { AgentStore, RunStatus } from "./store";
import { withToolTimeouts } from "./timeouts";

/** Tool calls of the last assistant message that have no result yet: what an approval wait is waiting on. */
export function pendingCalls(history: ModelMessage[]): ToolCallPart[] {
	const at = history.findLastIndex((m) => m.role === "assistant");
	const last = history[at];
	if (!last || typeof last.content === "string") return [];
	const done = new Set(
		history
			.slice(at + 1)
			.flatMap((m) => (m.role === "tool" ? m.content : []))
			.map((p) => p.type === "tool-result" && p.toolCallId),
	);
	return last.content.filter(
		(p): p is ToolCallPart => p.type === "tool-call" && !done.has(p.toolCallId),
	);
}

type Agent = Omit<
	Parameters<typeof runAgent>[0],
	"history" | "onMessages" | "onTrim" | "onSummary"
>;

/** Runs the call the user approved (or not) and returns its result, shaped as the SDK shapes one. */
async function decide(
	agent: Agent,
	call: ToolCallPart,
	approval: Approval,
	history: ModelMessage[],
) {
	const part = (output: ToolResultPart["output"]): ToolResultPart => ({
		type: "tool-result",
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		output,
	});
	if (!approval.ok)
		return part({ type: "execution-denied", reason: rejected(call.toolName, approval.reason) });
	const max = agent.limits.maxResultChars ?? MAX_RESULT_CHARS;
	const tool = guardTools(withToolTimeouts(agent.tools, agent.limits.toolMs), newGuard(), max)[
		call.toolName
	];
	try {
		if (!tool?.execute) throw new Error(`No tool named ${call.toolName}`);
		const out = await tool.execute(call.input, {
			toolCallId: call.toolCallId,
			messages: history,
			abortSignal: agent.abortSignal,
			context: undefined,
		});
		return part(
			typeof out === "string" ? { type: "text", value: out } : { type: "json", value: out ?? null },
		);
	} catch (e) {
		return part({ type: "error-text", value: e instanceof Error ? e.message : String(e) });
	}
}

/**
 * The next turn of a stored conversation (#645). The run row exists already.
 * Waiting on an approval, `approval` answers the first pending call and
 * `decisions` the ones they name: each runs (or is rejected), its result is
 * stored, and the loop goes on once nothing else waits. Otherwise `message` is the user's new message. Every finished
 * message and summary is stored as the loop goes. `result` is the run's stream
 * (none while other calls still wait); `status` settles when the run ends:
 * `waiting_approval` when `approve` deferred a call.
 */
export async function continueConversation(o: {
	store: AgentStore;
	conversationId: string;
	runId: string;
	agent: Agent;
	message?: string;
	approval?: Approval;
	/** Several answers at once (#704): the calls named run in order, the rest stay pending. */
	decisions?: (Approval & { toolCallId: string })[];
	/** The approved call ran (or was turned down): its result is saved, at `seq`, before the loop goes on. */
	onDecided?: (result: ToolResultPart, seq: number) => void;
}) {
	const { store, conversationId, runId, agent } = o;
	const view = await store.modelView(conversationId);
	const history = view.map((v) => v.message);
	const seqs = new Map(view.map((v) => [v.message, v.seq]));
	/** A trim batch not yet saved: its line rides on the next assistant row (the model view strips it). */
	let trim: Compaction | undefined;
	const record = async (list: ModelMessage[]) => {
		const stored = list.map((m) => {
			if (m.role !== "assistant" || !trim) return m;
			const line = { ...m, compaction: trim } as ModelMessage;
			trim = undefined;
			return line;
		});
		const assigned = await store.append(conversationId, runId, stored);
		for (const [i, m] of list.entries()) seqs.set(m, assigned[i]);
	};
	const save = async (list: ModelMessage[]) => {
		await record(list);
		history.push(...list);
	};
	const settle = async (status: RunStatus) => {
		await store.setRunStatus(runId, status);
		return status;
	};

	const pending = pendingCalls(history);
	if (pending.length) {
		// A single `approval` answers the first pending call, `decisions` the ones they name.
		const answers = new Map(
			o.decisions?.map((d) => [d.toolCallId, d] as const) ??
				(o.approval ? [[pending[0].toolCallId, o.approval] as const] : []),
		);
		if (!answers.size) throw new Error("The run is waiting for an approval; answer it first.");
		// In the order the model made the calls, one after another: writes to one canvas would clash on version.
		for (const call of pending) {
			const approval = answers.get(call.toolCallId);
			if (!approval) continue;
			const decided = await decide(agent, call, approval, history);
			const msg: ModelMessage = { role: "tool", content: [decided] };
			await save([msg]);
			o.onDecided?.(decided, seqs.get(msg) as number);
		}
		if (pendingCalls(history).length) return { status: settle("waiting_approval") };
	} else {
		if (!o.message) throw new Error("A message is needed to continue the conversation.");
		await save([{ role: "user", content: o.message }]);
	}
	await settle("executing");

	// Stored one after another, so seqs follow history order. A failed write
	// stops the run: going on would leave the stored conversation behind.
	const ctrl = new AbortController();
	agent.abortSignal?.addEventListener("abort", () => ctrl.abort(agent.abortSignal?.reason), {
		once: true,
	});
	// A stop that came while the conversation was loading.
	if (agent.abortSignal?.aborted) ctrl.abort(agent.abortSignal.reason);
	let queue = Promise.resolve();
	let failure: unknown;
	const enqueue = (job: () => Promise<void>) => {
		const next = queue.then(job);
		queue = next.catch((e) => {
			failure ??= e;
			ctrl.abort(e);
		});
		return next;
	};
	const result = runAgent({
		...agent,
		history,
		abortSignal: ctrl.signal,
		onMessages: (list) => enqueue(() => record(list)),
		onTrim: (event) => {
			trim = event;
		},
		onSummary: (summary, covered, event) =>
			enqueue(async () => {
				const covers = Math.max(...covered.map((m) => seqs.get(m) ?? -1));
				await store.appendSummary(conversationId, runId, summary, covers, event);
				seqs.set(summary, covers);
			}),
	});
	const status = (async () => {
		await result.consumeStream();
		await queue;
		if (failure) {
			await settle("failed");
			throw failure;
		}
		if (pendingCalls(history).length) return settle("waiting_approval");
		return settle(ctrl.signal.aborted ? "interrupted" : "completed");
	})();
	return { result, status };
}

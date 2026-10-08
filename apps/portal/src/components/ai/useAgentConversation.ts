import type { AgentEvent } from "@fluxify/ai-gateway/src/agent/runner/events";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentConversationsKey, agentConversationsQuery } from "@/query/agentConversationsQuery";
import { agentConversationsService } from "@/services/agentConversations";
import { applyEvent, chatView, EMPTY_LIVE, type Live } from "./agentMessages";

/** Run statuses a job still holds (or will): the stream is open for these. */
const ACTIVE = new Set(["queued", "executing"]);
const EVENTS: AgentEvent["type"][] = [
	"text",
	"reasoning",
	"tool-start",
	"tool-end",
	"approval",
	"compaction",
	"done",
	"error",
];
export const RETRY_MS = 1000;

/** A message typed on the new-chat page, sent once its conversation page loads. */
const queued = new Map<string, string>();
export const queueMessage = (conversationId: string, text: string) =>
	queued.set(conversationId, text);

/**
 * A new-agent conversation, live. Loads the saved rows; while a run is
 * active, follows its SSE from the highest saved seq and applies the events
 * into in-progress assistant messages. On `done` it reloads the rows (live
 * messages they already hold are dropped by seq). A dropped stream reloads
 * and reopens from the new highest seq, so replayed events never double up.
 */
export function useAgentConversation(projectId: string, conversationId: string) {
	const qc = useQueryClient();
	const detail = agentConversationsQuery.detail.useQuery(projectId, conversationId);
	const { refetch } = detail;
	const rows = detail.data?.messages ?? [];
	const run = detail.data?.run ?? null;
	const top = useRef(-1);
	top.current = rows.at(-1)?.seq ?? -1;

	const [live, setLive] = useState<Live>(EMPTY_LIVE);
	/** The run this page started, followed before a reload shows it. */
	const [started, setStarted] = useState<string | null>(null);
	const [pending, setPending] = useState<{ text: string; afterSeq: number } | null>(null);
	const [attempt, setAttempt] = useState(0);
	const streamId = started ?? (run && ACTIVE.has(run.status) ? run.id : null);

	useEffect(() => {
		if (!streamId) return;
		let closed = false;
		let disposed = false;
		setLive({ ...EMPTY_LIVE, lastEventAt: Date.now() });
		const es = new EventSource(agentConversationsService.streamUrl(streamId, top.current), {
			withCredentials: true,
		});
		const onEvent = (m: MessageEvent) => {
			const e = JSON.parse(m.data) as AgentEvent;
			setLive((l) => applyEvent(l, e));
			if (e.type !== "done" && e.type !== "error") return;
			closed = true;
			es.close();
			void refetch().then(() => {
				setStarted(null);
				setPending(null);
				setLive((l) => ({ ...EMPTY_LIVE, end: l.end }));
				qc.invalidateQueries({ queryKey: [...agentConversationsKey(projectId), "list"] });
			});
		};
		for (const type of EVENTS) es.addEventListener(type, onEvent as EventListener);
		es.onerror = () => {
			if (closed) return;
			closed = true;
			es.close();
			setTimeout(() => {
				if (!disposed) void refetch().then(() => setAttempt((a) => a + 1));
			}, RETRY_MS);
		};
		return () => {
			closed = true;
			disposed = true;
			es.close();
		};
	}, [streamId, attempt, refetch, qc, projectId]);

	const send = async (text: string) => {
		setPending({ text, afterSeq: top.current });
		setLive({ ...EMPTY_LIVE, lastEventAt: Date.now() });
		try {
			// PR 2 adds the mode picker.
			const { runId } = await agentConversationsService.send(
				projectId,
				conversationId,
				text,
				"manual",
			);
			setStarted(runId);
		} catch (e) {
			setPending(null);
			throw e;
		}
	};

	const stop = async () => {
		await agentConversationsService.stop(projectId, conversationId);
		// A queued or waiting run is stopped right here and sends no `done`.
		const r = await refetch();
		if (r.data?.run && !ACTIVE.has(r.data.run.status)) {
			setStarted(null);
			setPending(null);
			setLive(EMPTY_LIVE);
		}
	};

	const loaded = Boolean(detail.data);
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per conversation, when it has loaded
	useEffect(() => {
		const text = queued.get(conversationId);
		if (!loaded || text === undefined) return;
		queued.delete(conversationId);
		send(text).catch(showErrorNotification);
	}, [conversationId, loaded]);

	const running = Boolean(streamId) || Boolean(pending);
	const waiting = !running && run?.status === "waiting_approval";
	const end = live.end;
	const messages = useMemo(() => chatView(rows, live, pending), [rows, live, pending]);
	return {
		conversation: detail.data?.conversation ?? null,
		isLoading: detail.isLoading,
		messages,
		running,
		/** Stopped on a call that needs approval (PR 2 answers it). */
		waiting,
		/** When the last event came, for the thinking timer. */
		lastEventAt: live.lastEventAt,
		error: end?.type === "error" ? end.message : null,
		/** The last run stopped at its step or token limit. */
		stopReason: running
			? null
			: (run?.stopReason ?? (end?.type === "done" ? end.reason : null) ?? null),
		send,
		stop,
	};
}

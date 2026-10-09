import type { AgentEvent } from "@fluxify/ai-gateway/src/agent/runner/events";
import { toast } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentConversationsKey, agentConversationsQuery } from "@/query/agentConversationsQuery";
import {
	type AgentRow,
	type ApprovalAnswer,
	agentConversationsService,
	type Effort,
	type Mode,
} from "@/services/agentConversations";
import { type ApprovalRequest, planReply, waitingCall } from "./agentApproval";
import { applyEvent, chatView, EMPTY_LIVE, type Live } from "./agentMessages";
import { parseSlash, type SlashName } from "./slashCommands";

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

/** The mode and effort a message goes out with; what the pickers show unless a send overrides them. */
type Picks = { mode?: Mode; effort?: Effort };

/** A message typed on the new-chat page, sent once its conversation page loads (with the pickers' values). */
const queued = new Map<string, { text: string } & Picks>();
export const queueMessage = (conversationId: string, text: string, picks: Picks = {}) =>
	queued.set(conversationId, { text, ...picks });

/** Sent by Approve in plan mode: the same words as the terminal's Start?. */
export const START_PLAN = "Go ahead with the plan.";

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
	const latest = detail.data?.messages ?? [];
	/** Older pages loaded by scrolling up, and the cursor of the page before them. */
	const [older, setOlder] = useState<{ id: string; rows: AgentRow[]; next: number | null } | null>(
		null,
	);
	const [loadingOlder, setLoadingOlder] = useState(false);
	// Reloads only return the latest page: keep the older ones loaded while they still join it
	// (a run that wrote more than a page in between leaves a gap, so they go).
	const first = latest[0]?.seq ?? 0;
	const kept = older?.id !== conversationId ? [] : older.rows.filter((r) => r.seq < first);
	const joined = kept.length > 0 && kept.at(-1)?.seq === first - 1;
	const rows = joined ? [...kept, ...latest] : latest;
	const nextBeforeSeq = joined ? older?.next : (detail.data?.nextBeforeSeq ?? null);
	const run = detail.data?.run ?? null;
	const top = useRef(-1);
	top.current = rows.at(-1)?.seq ?? -1;

	const [live, setLive] = useState<Live>(EMPTY_LIVE);
	/** The run this page started, followed before a reload shows it. */
	const [started, setStarted] = useState<string | null>(null);
	const [pending, setPending] = useState<{ text: string; afterSeq: number } | null>(null);
	/** When this page started the run it follows; after a refresh the run row's createdAt stands in. */
	const [startedAt, setStartedAt] = useState<number | null>(null);
	/** This page started a /compact job and follows it. */
	const [compactStarted, setCompactStarted] = useState(false);
	const [attempt, setAttempt] = useState(0);
	/** The pickers move this; until they do, the conversation's saved settings show. */
	const [picked, setPicked] = useState<Picks>({});
	/** The plan the user turned down (by the seq of its message), so its bar stays away. */
	const [dismissed, setDismissed] = useState(-1);
	const saved = detail.data?.settings;
	const mode = picked.mode ?? saved?.mode ?? "manual";
	const effort = picked.effort ?? saved?.effort ?? "none";
	const streamId = started ?? (run && ACTIVE.has(run.status) ? run.id : null);

	useEffect(() => {
		if (!streamId) return;
		let closed = false;
		let disposed = false;
		setLive((l) => ({
			...EMPTY_LIVE,
			results: l.results,
			callStartedAt: l.callStartedAt,
			lastEventAt: Date.now(),
		}));
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
				setStartedAt(null);
				setPending(null);
				setCompactStarted(false);
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

	/** Fetches the page before the oldest loaded row. */
	const loadOlder = async () => {
		if (loadingOlder || nextBeforeSeq == null) return;
		setLoadingOlder(true);
		try {
			const page = await agentConversationsService.getOlder(
				projectId,
				conversationId,
				nextBeforeSeq,
			);
			setOlder({ id: conversationId, rows: [...page.messages, ...rows], next: page.nextBeforeSeq });
		} catch (e) {
			showErrorNotification(e);
		} finally {
			setLoadingOlder(false);
		}
	};

	const send = async (text: string, over: Picks = {}) => {
		const go = { mode: over.mode ?? mode, effort: over.effort ?? effort };
		setCompactStarted(false);
		setStartedAt(Date.now());
		setPending({ text, afterSeq: top.current });
		setLive({ ...EMPTY_LIVE, lastEventAt: Date.now() });
		try {
			const { runId } = await agentConversationsService.send(
				projectId,
				conversationId,
				text,
				go.mode,
				go.effort,
			);
			setPicked(go);
			setStarted(runId);
		} catch (e) {
			setPending(null);
			throw e;
		}
	};

	/** /compact: summarizes the conversation as a job of its own and follows it; the summary line arrives as an event. */
	const compact = async (text: string) => {
		if (running || waiting) throw new Error("Wait for the current run to finish before compacting");
		const { runId, message } = await agentConversationsService.compact(
			projectId,
			conversationId,
			text || undefined,
		);
		if (!runId) return void toast.info(message ?? "Nothing to compact yet");
		setCompactStarted(true);
		setStartedAt(Date.now());
		setLive({ ...EMPTY_LIVE, lastEventAt: Date.now() });
		setStarted(runId);
	};
	/** One handler per slash command; typed by the commands list, so a new command cannot be forgotten. */
	const slash: Record<SlashName, (args: string) => Promise<void>> = { compact };

	/** Answers the call the run waits on; the run goes on with the mode it picks. */
	const answer = async (a: ApprovalAnswer) => {
		const go = { mode: a.mode ?? mode, effort };
		// A no ends the row now; the run's own tool-end says the same a moment later.
		const call = !a.approve && approval?.kind === "tool" ? approval.id : undefined;
		const results: Live["results"] = call
			? { [call]: { status: "rejected", error: a.reason ?? "Not approved", endedAt: Date.now() } }
			: {};
		if (call) setLive((l) => ({ ...l, results }));
		const { runId } = await agentConversationsService.approve(projectId, conversationId, {
			...a,
			...go,
		});
		setPicked(go);
		setLive({ ...EMPTY_LIVE, results, lastEventAt: Date.now() });
		setStartedAt(Date.now());
		setStarted(runId);
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
		const first = queued.get(conversationId);
		if (!loaded || first === undefined) return;
		queued.delete(conversationId);
		const { text, ...over } = first;
		send(text, over).catch(showErrorNotification);
	}, [conversationId, loaded]);

	const running = Boolean(streamId) || Boolean(pending);
	const waiting = !running && run?.status === "waiting_approval";
	const end = live.end;
	// After a refresh the page did not start the job: the run row says what it is.
	const compacting =
		running &&
		(compactStarted || (streamId === run?.id && !!run?.userQuery?.startsWith("/compact")));
	const messages = useMemo(() => chatView(rows, live, pending), [rows, live, pending]);

	/** What the bar above the editor asks: the call that waits, or a plan in plan mode that is ready to start. */
	const lastSeq = messages.at(-1)?.seq ?? -1;
	const plan = !running && !waiting && saved?.mode === "plan" && run?.status === "completed";
	const approval: ApprovalRequest | undefined = waiting
		? (waitingCall(messages) ?? {
				kind: "tool",
				name: "the next step",
				title: "the next step",
				input: undefined,
				isDelete: false,
			})
		: plan && planReply(messages) && dismissed !== lastSeq
			? { kind: "plan" }
			: undefined;
	/** Typed text while something waits is the reason the user turns it down; otherwise it is a new message. */
	const submit = (text: string) => {
		const command = parseSlash(text);
		if (command) return slash[command.command.name](command.args);
		return waiting ? answer({ approve: false, reason: text }) : send(text);
	};
	const approve = (to: Mode) =>
		plan ? send(START_PLAN, { mode: to }) : answer({ approve: true, mode: to });
	const reject = () => (plan ? Promise.resolve(setDismissed(lastSeq)) : answer({ approve: false }));
	return {
		conversation: detail.data?.conversation ?? null,
		isLoading: detail.isLoading,
		/** There are older rows to load by scrolling up. */
		hasOlder: nextBeforeSeq != null,
		loadingOlder,
		loadOlder,
		messages,
		rows,
		run,
		running,
		/** Stopped on a call that needs approval. */
		waiting,
		approval,
		approve,
		reject,
		submit,
		mode,
		setMode: (m: Mode) => setPicked((p) => ({ ...p, mode: m })),
		effort,
		setEffort: (e: Effort) => setPicked((p) => ({ ...p, effort: e })),
		supportsThinking: saved?.supportsThinking ?? false,
		lastEventAt: live.lastEventAt,
		/**
		 * When the model call in progress began, for the thinking timer: the last tool result
		 * this page's stream saw, else the run's start; after a refresh, the last saved row (or
		 * the run's start), which is the same moment. Each call counts from its own start.
		 */
		thinkingSince:
			live.callStartedAt ??
			startedAt ??
			(Math.max(
				Date.parse(rows.at(-1)?.createdAt ?? "") || 0,
				Date.parse(run?.createdAt ?? "") || 0,
			) ||
				live.lastEventAt),
		/** A /compact job is running: no model turn follows it. */
		compacting,
		error: end?.type === "error" ? end.message : null,
		/** The last run stopped at its step or token limit. */
		stopReason: running
			? null
			: (run?.stopReason ?? (end?.type === "done" ? end.reason : null) ?? null),
		send,
		stop,
	};
}

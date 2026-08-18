import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ApplyMode } from "@/components/ai/ApplyModeSelect";
import { useShallow } from "zustand/react/shallow";
import {
	RUN_NODE,
	TERMINAL_RUN_STATUSES,
	type HarnessEventNode,
	type HarnessExecutionType,
	type HarnessLevel,
	type HarnessNodePayload,
	type HarnessNodeStatus,
	type HarnessRunResult,
	type HarnessRunStatus,
	type HarnessSnapshot,
	type HarnessSocketMessage,
	type HarnessStreamEvent,
	type HarnessTaskView,
} from "@fluxify/ai-gateway/src/harness/clientContract";
import type { z } from "zod";
import type * as harnessConversationsListDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/list/dto";
import { applyNodePayload } from "./harnessNodeReducers";

/* ============================================================================
 * AI HARNESS STORE — SINGLE SOURCE OF TRUTH FOR THE AI UI
 * ----------------------------------------------------------------------------
 * Two slices:
 *  - `list`  : conversation metadata, hydrated from REST (titles, pinned, ...)
 *  - `runs`  : live run state per conversationId, driven ONLY by the socket
 *
 * Every socket message — the `full_state` catch-up and each live `update` —
 * funnels through the same idempotent, timestamp-guarded `applyEvent`. That is
 * what makes replays, reconnect snapshots and out-of-order arrivals safe:
 * applying an event twice is a no-op, and an older event never regresses a
 * newer field.
 * ========================================================================== */

const TERMINAL = new Set<string>(TERMINAL_RUN_STATUSES);

export interface StepLog {
	label: string;
	timestamp: number;
	executionType: HarnessExecutionType;
	toolName?: string;
	nodeStatus: HarnessNodeStatus;
}

/** One node execution, keyed by `nodeId` — every event of that instance
 *  (started, running, tool calls, ended) upserts the same entry. */
export interface StepUIState {
	nodeId: string;
	node: HarnessEventNode;
	level: HarnessLevel;
	nodeStatus: HarnessNodeStatus;
	executionType: HarnessExecutionType;
	/** Latest `plainTextMessage` — what the node is doing right now. */
	label: string;
	/** Tool currently running inside this node, if any. */
	toolName?: string;
	payload?: HarnessNodePayload;
	timestamp: number;
	logs: StepLog[];
}

/** Everything the UI needs to render one conversation's live/last run. */
export interface ConversationUIState {
	conversationId: string;
	runId: string;
	runStatus: HarnessRunStatus;
	currentNode?: HarnessEventNode;
	currentLevel?: HarnessLevel;
	/** No more events for this run pass. `awaiting_hitl` is terminal-but-resumable. */
	isTerminal: boolean;
	/** Newest event timestamp applied — the ordering source of truth. */
	lastTimestamp: number;
	steps: Record<string, StepUIState>;
	tasksByLevel: HarnessTaskView[][];
	activeLevel?: number;
	intent?: "discussion" | "builder";
	capable?: boolean;
	rejectReason?: string;
	plan?: string;
	discussion?: string;
	summary?: string;
	artifactId?: string;
	hitl?: { reason: string; markdownPlan?: string };
	/** Set once by the run-level `ended` event — the final outcome + result. */
	result?: HarnessRunResult;
}

export interface SelectedArtifact {
	id: string;
	type: string;
	props: Record<string, any>;
}

export type ConversationMeta = z.infer<
	typeof harnessConversationsListDto.conversationSchema
>;

export interface AiHarnessState {
	connected: boolean;
	connectionError?: string;
	activeConversationId: string | null;
	list: ConversationMeta[];
	runs: Record<string, ConversationUIState>;
	selectedModelId: string | null;
	/** Which human gates the next run stops at. Sent with every message; the
	 *  server treats an absent value as "manual", the pre-existing behaviour. */
	applyMode: ApplyMode;
	selectedArtifact: SelectedArtifact | null;
}

export interface AiHarnessActions {
	setConnected: (connected: boolean) => void;
	setConnectionError: (message?: string) => void;
	/** Entry point for every server message. */
	applySocketMessage: (message: HarnessSocketMessage) => void;
	setActiveConversation: (conversationId: string | null) => void;
	setConversationList: (items: ConversationMeta[]) => void;
	upsertConversation: (item: ConversationMeta) => void;
	removeConversation: (conversationId: string) => void;
	clearRun: (conversationId: string) => void;
	optimisticResume: (conversationId: string) => void;
	setSelectedModelId: (id: string | null) => void;
	setApplyMode: (mode: ApplyMode) => void;
	setSelectedArtifact: (artifact: SelectedArtifact | null) => void;
	reset: () => void;
}

const initialState: AiHarnessState = {
	connected: false,
	activeConversationId: null,
	list: [],
	runs: {},
	selectedModelId: null,
	applyMode: "manual",
	selectedArtifact: null,
};

/* ----------------------------------------------------------------------------
 * Pure reducer helpers (exported for tests)
 * -------------------------------------------------------------------------- */

function emptyRun(conversationId: string, runId: string): ConversationUIState {
	return {
		conversationId,
		runId,
		runStatus: "queued",
		isTerminal: false,
		lastTimestamp: 0,
		steps: {},
		tasksByLevel: [],
	};
}

/**
 * Merges one harness event into the conversation state. Idempotent and
 * timestamp-guarded — safe to call with the same event any number of times, in
 * any order.
 */
export function applyEvent(
	state: AiHarnessState,
	event: HarnessStreamEvent,
): void {
	const { conversationId } = event;
	const run = (state.runs[conversationId] ??= emptyRun(
		conversationId,
		event.runId,
	));

	const isRunLevel = event.currentNode === RUN_NODE;

	// 1) Scalars only ever move forward in time.
	if (event.timestamp >= run.lastTimestamp) {
		run.runId = event.runId;
		run.runStatus = event.runStatus;
		if (!isRunLevel) run.currentNode = event.currentNode;
		run.currentLevel = event.level;
		run.lastTimestamp = event.timestamp;
		// The run-level `ended` bookend is the ONLY terminal signal.
		run.isTerminal = isRunLevel && event.nodeStatus === "ended";
		// HITL is a pause, not an end: a fresh node run means the user answered.
		if (
			event.nodeStatus === "started" &&
			!isRunLevel &&
			event.currentNode !== "humanInTheLoop"
		) {
			run.hitl = undefined;
		}
	}

	// 2) Step upsert, keyed by `nodeId`. Creates as readily as it updates: the
	//    Redis queue is bounded, so an `ended` can arrive with no `started`.
	//    A tool event updates its parent node's row (same nodeId) rather than
	//    creating one, so `ended` on a tool must not complete the node.
	if (!isRunLevel) {
		const prev = run.steps[event.nodeId];
		const isTool = event.executionType === "tool";
		
		const newLog: StepLog = {
			label: event.plainTextMessage,
			timestamp: event.timestamp,
			executionType: event.executionType,
			toolName: isTool ? event.toolName : undefined,
			nodeStatus: event.nodeStatus,
		};
		
		const logs = prev?.logs ? [...prev.logs] : [];
		const isDuplicate = logs.some(
			(l) =>
				l.timestamp === newLog.timestamp &&
				l.label === newLog.label &&
				l.executionType === newLog.executionType &&
				l.nodeStatus === newLog.nodeStatus
		);
		if (!isDuplicate) {
			logs.push(newLog);
			logs.sort((a, b) => a.timestamp - b.timestamp);
		}

		if (!prev || event.timestamp >= prev.timestamp) {
			run.steps[event.nodeId] = {
				nodeId: event.nodeId,
				node: event.currentNode,
				level: event.level,
				nodeStatus: isTool
					? (prev?.nodeStatus ?? "running")
					: event.nodeStatus === "started" && prev?.nodeStatus === "ended"
						? "ended"
						: event.nodeStatus,
				executionType: event.executionType,
				label: event.plainTextMessage,
				toolName: isTool && event.nodeStatus === "started" ? event.toolName : undefined,
				payload: event.payload ?? prev?.payload,
				timestamp: event.timestamp,
				logs,
			};
		} else if (prev) {
			prev.logs = logs;
		}
	}

	// 3) The final outcome, delivered once on the run-level `ended` event.
	if (isRunLevel && event.payload?.node === RUN_NODE) {
		run.result = event.payload.data;
	}

	// 4) Node-specific projection (plan, summary, task DAG, ...).
	if (event.payload) applyNodePayload(run, event.payload, event);
}

/**
 * Merges a reconnect/catch-up snapshot. The snapshot's own status acts as a
 * floor only when it is newer than everything already applied — a live `update`
 * can legitimately beat `full_state` to the client.
 */
export function applySnapshot(
	state: AiHarnessState,
	snapshot: HarnessSnapshot,
): void {
	state.runs[snapshot.conversationId] ??= emptyRun(
		snapshot.conversationId,
		snapshot.runId,
	);
	for (const event of snapshot.events) applyEvent(state, event);

	const run = state.runs[snapshot.conversationId];
	if (snapshot.updatedAt >= run.lastTimestamp) {
		run.runId = snapshot.runId;
		run.runStatus = snapshot.runStatus;
		run.currentNode = snapshot.currentNode ?? run.currentNode;
		run.currentLevel = snapshot.currentLevel ?? run.currentLevel;
		run.lastTimestamp = snapshot.updatedAt;
		run.isTerminal = TERMINAL.has(snapshot.runStatus);
	}
}

export function applyMessage(
	state: AiHarnessState,
	message: HarnessSocketMessage,
): void {
	if (message.type === "full_state") {
		// Merge, never replace: a run missing from a later snapshot has simply
		// aged out of Redis (60s TTL after it finishes), not ceased to exist.
		for (const snapshot of message.conversations) applySnapshot(state, snapshot);
		return;
	}
	// Artifact status is a toast, handled at the transport (`harnessSocket.ts`).
	// It carries no run state and can arrive after its run has ended.
	if (message.type !== "update") return;
	applyEvent(state, message.event);
}

/* ----------------------------------------------------------------------------
 * Store
 * -------------------------------------------------------------------------- */

export const useAiHarnessStore = create<AiHarnessState & AiHarnessActions>()(
	immer((set) => ({
		...initialState,

		setConnected: (connected) =>
			set((state) => {
				state.connected = connected;
				if (connected) state.connectionError = undefined;
			}),

		setConnectionError: (message) =>
			set((state) => {
				state.connectionError = message;
			}),

		applySocketMessage: (message) =>
			set((state) => {
				applyMessage(state as unknown as AiHarnessState, message);
			}),

		setActiveConversation: (conversationId) =>
			set((state) => {
				state.activeConversationId = conversationId;
			}),

		setConversationList: (items) =>
			set((state) => {
				state.list = items;
			}),

		upsertConversation: (item) =>
			set((state) => {
				const index = state.list.findIndex((c) => c.id === item.id);
				if (index === -1) state.list.unshift(item);
				else state.list[index] = item;
			}),

		removeConversation: (conversationId) =>
			set((state) => {
				state.list = state.list.filter((c) => c.id !== conversationId);
				delete state.runs[conversationId];
			}),

		clearRun: (conversationId) =>
			set((state) => {
				delete state.runs[conversationId];
			}),

		optimisticResume: (conversationId) =>
			set((state) => {
				const run = state.runs[conversationId];
				if (run) {
					run.runStatus = "executing";
					run.isTerminal = false;
				}
			}),

		setSelectedModelId: (id) =>
			set((state) => {
				state.selectedModelId = id;
			}),

		setApplyMode: (mode) =>
			set((state) => {
				state.applyMode = mode;
			}),

		setSelectedArtifact: (artifact) =>
			set((state) => {
				state.selectedArtifact = artifact;
			}),

		// Only for logout / project switch. NOT called on disconnect — reconnects
		// must keep the data they already have.
		reset: () => set(() => ({ ...initialState })),
	})),
);

/* ----------------------------------------------------------------------------
 * Selectors
 * -------------------------------------------------------------------------- */

export const useHarnessConnection = () =>
	useAiHarnessStore(
		useShallow((s) => ({ connected: s.connected, error: s.connectionError })),
	);

export const useConversationRun = (conversationId?: string | null) =>
	useAiHarnessStore((s) =>
		conversationId ? s.runs[conversationId] : undefined,
	);

export const useActiveRun = () =>
	useAiHarnessStore((s) =>
		s.activeConversationId ? s.runs[s.activeConversationId] : undefined,
	);

/** Steps oldest-first — the conversation timeline. */
export const useConversationSteps = (conversationId?: string | null) =>
	useAiHarnessStore(
		useShallow((s) => {
			const run = conversationId ? s.runs[conversationId] : undefined;
			if (!run) return [] as StepUIState[];
			return Object.values(run.steps).sort((a, b) => a.timestamp - b.timestamp);
		}),
	);

/** True while a run is streaming (i.e. not finished, failed or parked at HITL). */
export const useIsRunning = (conversationId?: string | null) =>
	useAiHarnessStore((s) => {
		const run = conversationId ? s.runs[conversationId] : undefined;
		return !!run && !run.isTerminal;
	});

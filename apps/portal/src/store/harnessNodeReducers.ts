import type {
	HarnessNodePayload,
	HarnessStreamEvent,
} from "@fluxify/ai-gateway/src/harness/clientContract";
import type { ConversationUIState } from "./aiHarness";

/* ============================================================================
 * NODE PAYLOAD REDUCERS — THE EXTENSION POINT
 * ----------------------------------------------------------------------------
 * Everything node-specific lives here, and only here. The socket layer and the
 * store reducer are node-agnostic: they upsert steps and guard timestamps, then
 * hand `event.payload` to the reducer registered for `payload.node`.
 *
 * Adding a node to the backend graph:
 *   1. add the variant to `HarnessNodePayload` (ai-gateway/src/harness/streamTypes.ts)
 *   2. add a key below IF the node projects something onto the conversation
 *      (plan, summary, task DAG...). If the step timeline is enough, add nothing —
 *      the step is stored with its payload automatically.
 * The mapped type derives its keys from the backend union, so a new node shows
 * up here as a typed, optional slot with its `data` already narrowed.
 * ========================================================================== */

export type NodePayloadReducers = {
	[P in HarnessNodePayload as `${P["node"]}`]?: (
		draft: ConversationUIState,
		data: P["data"],
		event: HarnessStreamEvent,
	) => void;
};

export const nodePayloadReducers: NodePayloadReducers = {
	// The router is also the capability gate — a rejected build request carries
	// its reason here and the run ends straight after.
	router: (draft, data) => {
		if (data.intent) draft.intent = data.intent;
		if (data.capable !== undefined) draft.capable = data.capable;
		if (data.rejectReason) draft.rejectReason = data.rejectReason;
	},
	planner: (draft, data) => {
		if (data.markdownPlan) draft.plan = data.markdownPlan;
	},
	discussion: (draft, data) => {
		if (data.markdown) draft.discussion = data.markdown;
	},
	// tasksByLevel is a full recompute of the DAG every time — REPLACE, never merge.
	taskGenerator: (draft, data) => {
		draft.tasksByLevel = data.tasksByLevel;
	},
	orchestrator: (draft, data) => {
		draft.tasksByLevel = data.tasksByLevel;
		draft.activeLevel = data.activeLevel;
	},
	supervisor: (draft, data) => {
		draft.tasksByLevel = data.tasksByLevel;
	},
	summarizer: (draft, data) => {
		if (data.markdown) draft.summary = data.markdown;
		if (data.artifactId) draft.artifactId = data.artifactId;
	},
	humanInTheLoop: (draft, data) => {
		draft.hitl = { reason: data.reason, markdownPlan: data.markdownPlan };
	},
	// blockBuilder / routeConfig carry per-task results. They already live on the
	// step (keyed by stepId) and inside the next supervisor/orchestrator DAG, so
	// there is nothing extra to project onto the conversation.
};

/** Dispatches a payload to its node reducer. The single cast is contained here;
 *  the registry itself stays fully typed per node. */
export function applyNodePayload(
	draft: ConversationUIState,
	payload: HarnessNodePayload,
	event: HarnessStreamEvent,
): void {
	const reducer = nodePayloadReducers[payload.node] as
		| ((d: ConversationUIState, data: unknown, e: HarnessStreamEvent) => void)
		| undefined;
	reducer?.(draft, payload.data, event);
}

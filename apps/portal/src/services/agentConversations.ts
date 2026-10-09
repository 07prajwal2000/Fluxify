import type { StopReason } from "@fluxify/ai-gateway/src/agent/agent";
import type { Effort } from "@fluxify/ai-gateway/src/agent/model";
import type { Mode } from "@fluxify/ai-gateway/src/agent/tools";
import type { AgentConversation } from "@/components/ai/types";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `ai/v1/agent/${projectId}/conversations`;

/** One saved `agent_messages` row; `content` is an AI SDK ModelMessage. */
export type AgentRow = {
	seq: number;
	role: string;
	runId: string;
	content: unknown;
	/** When the row was saved (ISO). */
	createdAt?: string;
};
/** What a finished run cost, summed over its jobs. Null for runs from before it was recorded. */
export type AgentUsage = {
	steps: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	durationMs: number;
};
export type AgentRun = {
	id: string;
	/** When the run was queued (ISO). */
	createdAt?: string;
	/** What started it: the user's message, or `/compact …`. */
	userQuery?: string;
	status: string;
	stopReason: StopReason | null;
	usage: AgentUsage | null;
};
/** The pickers' saved state: what the conversation went on with last, and whether the project's model thinks. */
export type AgentSettings = { mode: Mode; effort: Effort; supportsThinking: boolean };
export type { Effort, Mode };
export type AgentConversationDetail = {
	conversation: AgentConversation & { activeRunId: string | null };
	/** The latest page of rows. */
	messages: AgentRow[];
	/** Pass it as `beforeSeq` for the page before these rows; null when there is none. */
	nextBeforeSeq: number | null;
	/** The conversation's latest run, settled or not. */
	run: AgentRun | null;
	settings: AgentSettings;
};
/** Rename, pin or archive; archiving unpins. */
export type ConversationPatch = { title?: string; pinned?: boolean; archived?: boolean };
export type Decision = { toolCallId: string; approve: boolean; reason?: string };
/**
 * An answer to the first waiting call, or `decisions` for several at once (the
 * calls not listed keep waiting); `mode` is the mode the conversation goes on in.
 */
export type ApprovalAnswer = { mode?: Mode; effort?: Effort } & (
	| { approve: boolean; reason?: string }
	| { decisions: Decision[] }
);

/** The new agent's API (#646). */
export const agentConversationsService = {
	async list(projectId: string): Promise<AgentConversation[]> {
		return (await httpClient.get(base(projectId))).data;
	},
	/** Does the project's model take a thinking setting? For the new-chat page, before a conversation exists. */
	async model(projectId: string): Promise<{ supportsThinking: boolean }> {
		return (await httpClient.get(`ai/v1/agent/${projectId}/model`)).data;
	},
	async create(projectId: string, title?: string): Promise<AgentConversation> {
		return (await httpClient.post(base(projectId), { title })).data;
	},
	async get(projectId: string, conversationId: string): Promise<AgentConversationDetail> {
		return (await httpClient.get(`${base(projectId)}/${conversationId}`)).data;
	},
	/** The page of rows before `beforeSeq`. */
	async getOlder(
		projectId: string,
		conversationId: string,
		beforeSeq: number,
	): Promise<{ messages: AgentRow[]; nextBeforeSeq: number | null }> {
		return (await httpClient.get(`${base(projectId)}/${conversationId}`, { params: { beforeSeq } }))
			.data;
	},
	async send(
		projectId: string,
		conversationId: string,
		text: string,
		mode: Mode,
		effort?: Effort,
	): Promise<{ runId: string }> {
		return (
			await httpClient.post(`${base(projectId)}/${conversationId}/messages`, { text, mode, effort })
		).data;
	},
	/** /compact: `runId` is the job to follow; null (with a `message`) when there was nothing to compact. */
	async compact(
		projectId: string,
		conversationId: string,
		instructions?: string,
	): Promise<{ runId: string | null; message?: string }> {
		return (await httpClient.post(`${base(projectId)}/${conversationId}/compact`, { instructions }))
			.data;
	},
	async approve(
		projectId: string,
		conversationId: string,
		answer: ApprovalAnswer,
	): Promise<{ runId: string }> {
		return (await httpClient.post(`${base(projectId)}/${conversationId}/approval`, answer)).data;
	},
	async update(projectId: string, conversationId: string, patch: ConversationPatch): Promise<void> {
		await httpClient.patch(`${base(projectId)}/${conversationId}`, patch);
	},
	async remove(projectId: string, conversationId: string): Promise<void> {
		await httpClient.delete(`${base(projectId)}/${conversationId}`);
	},
	async stop(projectId: string, conversationId: string): Promise<void> {
		await httpClient.post(`${base(projectId)}/${conversationId}/stop`);
	},
	/** SSE of a run, without the events of messages up to `afterSeq`. Same origin, so the session cookie goes along. */
	streamUrl: (runId: string, afterSeq: number) =>
		`/_/admin/api/ai/v1/agent/runs/${runId}/stream?afterSeq=${afterSeq}`,
};

import type { StopReason } from "@fluxify/ai-gateway/src/agent/agent";
import type { Effort } from "@fluxify/ai-gateway/src/agent/model";
import type { Mode } from "@fluxify/ai-gateway/src/agent/tools";
import type { HarnessConversation } from "@/components/ai/types";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `ai/v1/agent/${projectId}/conversations`;

/** One saved `agent_messages` row; `content` is an AI SDK ModelMessage. */
export type AgentRow = { seq: number; role: string; runId: string; content: unknown };
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
	status: string;
	stopReason: StopReason | null;
	usage: AgentUsage | null;
};
/** The pickers' saved state: what the conversation went on with last, and whether the project's model thinks. */
export type AgentSettings = { mode: Mode; effort: Effort; supportsThinking: boolean };
export type { Effort, Mode };
export type AgentConversationDetail = {
	conversation: HarnessConversation & { activeRunId: string | null };
	messages: AgentRow[];
	/** The conversation's latest run, settled or not. */
	run: AgentRun | null;
	settings: AgentSettings;
};
/** Rename, pin or archive; archiving unpins. */
export type ConversationPatch = { title?: string; pinned?: boolean; archived?: boolean };
/** An answer to the first waiting call; `mode` is the mode the conversation goes on in. */
export type ApprovalAnswer = { approve: boolean; reason?: string; mode?: Mode; effort?: Effort };

/** The new agent's API (#646). */
export const agentConversationsService = {
	async list(projectId: string): Promise<HarnessConversation[]> {
		return (await httpClient.get(base(projectId))).data;
	},
	/** Does the project's model take a thinking setting? For the new-chat page, before a conversation exists. */
	async model(projectId: string): Promise<{ supportsThinking: boolean }> {
		return (await httpClient.get(`ai/v1/agent/${projectId}/model`)).data;
	},
	async create(projectId: string, title?: string): Promise<HarnessConversation> {
		return (await httpClient.post(base(projectId), { title })).data;
	},
	async get(projectId: string, conversationId: string): Promise<AgentConversationDetail> {
		return (await httpClient.get(`${base(projectId)}/${conversationId}`)).data;
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

import type { StopReason } from "@fluxify/ai-gateway/src/agent/agent";
import type { Mode } from "@fluxify/ai-gateway/src/agent/tools";
import type { HarnessConversation } from "@/components/ai/types";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `ai/v1/agent/${projectId}/conversations`;

/** One saved `agent_messages` row; `content` is an AI SDK ModelMessage. */
export type AgentRow = { seq: number; role: string; runId: string; content: unknown };
export type AgentRun = { id: string; status: string; stopReason: StopReason | null };
export type AgentConversationDetail = {
	conversation: HarnessConversation & { activeRunId: string | null };
	messages: AgentRow[];
	/** The conversation's latest run, settled or not. */
	run: AgentRun | null;
};

/** The new agent's API (#646). */
export const agentConversationsService = {
	async list(projectId: string): Promise<HarnessConversation[]> {
		return (await httpClient.get(base(projectId))).data;
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
	): Promise<{ runId: string }> {
		return (await httpClient.post(`${base(projectId)}/${conversationId}/messages`, { text, mode }))
			.data;
	},
	async stop(projectId: string, conversationId: string): Promise<void> {
		await httpClient.post(`${base(projectId)}/${conversationId}/stop`);
	},
	/** SSE of a run, without the events of messages up to `afterSeq`. Same origin, so the session cookie goes along. */
	streamUrl: (runId: string, afterSeq: number) =>
		`/_/admin/api/ai/v1/agent/runs/${runId}/stream?afterSeq=${afterSeq}`,
};

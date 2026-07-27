import type { z } from "zod";
import { httpClient } from "@/lib/http";
import * as harnessConversationsListDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/list/dto";
import * as harnessConversationsUpdateDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/update/dto";
import * as harnessConversationsSendMessageDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/send-message/dto";
import * as harnessConversationsActionDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/action/dto";
import * as harnessConversationsListMessagesDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/list-messages/dto";

const baseUrl = (projectId: string) => `ai/v1/${projectId}/harness-conversations`;

export type ListHarnessConversationsQuery = z.infer<
	typeof harnessConversationsListDto.queryParamsSchema
>;

export const harnessConversationsService = {
	async list(
		projectId: string,
		query: ListHarnessConversationsQuery,
	): Promise<z.infer<typeof harnessConversationsListDto.responseSchema>> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 20));
		if (query.needUserQuery) params.set("needUserQuery", "true");
		if (query.archived) params.set("archived", "true");
		if (query.pinned !== undefined) params.set("pinned", String(query.pinned));
		if (query.search) params.set("search", query.search);
		const result = await httpClient.get(`${baseUrl(projectId)}?${params}`);
		return result.data;
	},
	/** Messages come back oldest-first, ready to render as-is. `cursor` walks
	 *  backwards through history 20 at a time. */
	async listMessages(
		projectId: string,
		conversationId: string,
		cursor?: string,
	): Promise<z.infer<typeof harnessConversationsListMessagesDto.responseSchema>> {
		const params = new URLSearchParams();
		if (cursor) params.set("cursor", cursor);
		const result = await httpClient.get(
			`${baseUrl(projectId)}/${conversationId}/messages?${params}`,
		);
		return result.data;
	},
	async update(
		projectId: string,
		conversationId: string,
		body: z.infer<typeof harnessConversationsUpdateDto.requestBodySchema>,
	): Promise<z.infer<typeof harnessConversationsUpdateDto.responseSchema>> {
		const result = await httpClient.patch(`${baseUrl(projectId)}/${conversationId}`, body);
		return result.data;
	},
	async delete(projectId: string, conversationId: string): Promise<void> {
		await httpClient.delete(`${baseUrl(projectId)}/${conversationId}`);
	},
	async sendMessage(
		projectId: string,
		body: z.infer<typeof harnessConversationsSendMessageDto.requestBodySchema>,
	): Promise<z.infer<typeof harnessConversationsSendMessageDto.responseSchema>> {
		const result = await httpClient.post(`${baseUrl(projectId)}/message`, body);
		return result.data;
	},
	async action(
		projectId: string,
		conversationId: string,
		body: z.infer<typeof harnessConversationsActionDto.requestBodySchema>,
	): Promise<z.infer<typeof harnessConversationsActionDto.responseSchema>> {
		const result = await httpClient.post(
			`${baseUrl(projectId)}/${conversationId}/action`,
			body,
		);
		return result.data;
	},
	updateRequestBodySchema: harnessConversationsUpdateDto.requestBodySchema,
	sendMessageRequestBodySchema: harnessConversationsSendMessageDto.requestBodySchema,
	actionRequestBodySchema: harnessConversationsActionDto.requestBodySchema,
	conversationActionEnum: harnessConversationsActionDto.conversationActionEnum,
};

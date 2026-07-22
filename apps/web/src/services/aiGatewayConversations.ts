import { z } from "zod";
import { httpClient } from "@/lib/http";
import {
	createConversationDto,
	clearConversationsDto,
	deleteConversationDto,
	updateMessageDto,
	listConversationsDto,
	listMessagesDto,
	clearMessagesDto,
	recordActionDto,
} from "@fluxify/ai-gateway";

const baseUrl = "ai/v1/conversations";

export const aiGatewayConversationsService = {
	async create(
		query: z.infer<typeof createConversationDto.queryParamsSchema>,
		body: z.infer<typeof createConversationDto.requestBodySchema>,
	): Promise<z.infer<typeof createConversationDto.responseSchema>> {
		const queryParams = new URLSearchParams();
		if (query.location) queryParams.set("location", query.location);
		if (query.routeId) queryParams.set("routeId", query.routeId);

		const queryString = queryParams.toString();
		const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

		const result = await httpClient.post(url, body);
		return result.data;
	},

	async list(
		projectId: string,
		query: z.infer<typeof listConversationsDto.queryParamsSchema>,
	): Promise<
		z.infer<typeof listConversationsDto.listConversationsResponseSchema>
	> {
		const queryParams = new URLSearchParams();
		if (query.location) queryParams.set("location", query.location);

		const result = await httpClient.get(
			`${baseUrl}/list/${projectId}?${queryParams.toString()}`,
		);
		return result.data;
	},

	async update(
		conversationId: string,
		body: z.infer<typeof updateMessageDto.requestBodySchema>,
	): Promise<void> {
		const result = await httpClient.put(`${baseUrl}/${conversationId}`, body);
		return result.data;
	},

	async delete(conversationId: string): Promise<void> {
		const result = await httpClient.delete(`${baseUrl}/${conversationId}`);
		return result.data;
	},

	async clear(
		conversationId: string,
		body: z.infer<typeof clearConversationsDto.requestBodySchema>,
	): Promise<void> {
		const result = await httpClient.post(
			`${baseUrl}/${conversationId}/clear`,
			body,
		);
		return result.data;
	},

	async listMessages(
		conversationId: string,
		query: z.infer<typeof listMessagesDto.queryParamsSchema>,
	): Promise<z.infer<typeof listMessagesDto.responseSchema>> {
		const queryParams = new URLSearchParams();
		if (query.page) queryParams.set("page", query.page.toString());
		if (query.perPage) queryParams.set("perPage", query.perPage.toString());

		const result = await httpClient.get(
			`${baseUrl}/${conversationId}/messages?${queryParams.toString()}`,
		);
		return result.data;
	},

	async recordAction(
		conversationId: string,
		body: any,
	): Promise<void> {
		const result = await httpClient.post(
			`${baseUrl}/${conversationId}/record-action`,
			body,
		);
		return result.data;
	},
};

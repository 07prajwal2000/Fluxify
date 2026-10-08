import * as harnessConversationsActionDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/action/dto";
import * as harnessConversationsUpdateDto from "@fluxify/ai-gateway/src/api/v1/harness-conversations/update/dto";
import type { z } from "zod";
import { httpClient } from "@/lib/http";

const baseUrl = (projectId: string) => `ai/v1/${projectId}/harness-conversations`;

export const harnessConversationsService = {
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
	async action(
		projectId: string,
		conversationId: string,
		body: z.infer<typeof harnessConversationsActionDto.requestBodySchema>,
	): Promise<z.infer<typeof harnessConversationsActionDto.responseSchema>> {
		const result = await httpClient.post(`${baseUrl(projectId)}/${conversationId}/action`, body);
		return result.data;
	},
	updateRequestBodySchema: harnessConversationsUpdateDto.requestBodySchema,
	actionRequestBodySchema: harnessConversationsActionDto.requestBodySchema,
};

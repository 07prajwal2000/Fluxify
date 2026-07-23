import { z } from "zod";
import { httpClient } from "@/lib/http";
import { postMessageDto, watchConversationDto } from "@fluxify/ai-gateway";

const baseUrl = "/ai/v1/workflows";

export const aiGatewayWorkflowsService = {
	async postMessage(
		param: z.infer<typeof postMessageDto.requestParamSchema>,
		body: z.infer<typeof postMessageDto.requestBodySchema>,
	): Promise<z.infer<typeof postMessageDto.responseSchema>> {
		const result = await httpClient.post(
			`${baseUrl}/${param.conversationId}`,
			body,
		);
		return result.data;
	},

	watchConversation(
		conversationId: string,
		onUpdate: (
			status: z.infer<typeof watchConversationDto.watchResponseSchema>,
		) => void,
		onError?: (err: Event) => void,
		onComplete?: () => void,
	): () => void {
		const eventSource = new EventSource(
			`/_/admin/api${baseUrl}/${conversationId}/watch`,
		);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as z.infer<
					typeof watchConversationDto.watchResponseSchema
				>;
				onUpdate(data);
				if (data.status === "error" || data.status === "success") {
					eventSource.close();
					if (onComplete) onComplete();
				}
			} catch (e) {
				console.error("Error parsing SSE data", e);
			}
		};

		eventSource.onerror = (err) => {
			if (onError) onError(err);
			eventSource.close();
		};

		// Return a cleanup function
		return () => {
			eventSource.close();
		};
	},
};

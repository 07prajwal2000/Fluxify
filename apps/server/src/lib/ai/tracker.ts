import type z from "zod";
import { CHAN_AI_SSE_PREFIX, publishMessage } from "../../db/redis";
import type {
	BuilderOutputSchema,
	ClassifierOutputSchema,
	DiscussionOutputSchema,
	PlannerOutputSchema,
} from "./schemas";

export type AiChatResponseData = {
	classifierOutput?: z.infer<typeof ClassifierOutputSchema>;
	discussionOutput?: z.infer<typeof DiscussionOutputSchema>;
	plannerOutput?: z.infer<typeof PlannerOutputSchema>;
	builderOutput?: z.infer<typeof BuilderOutputSchema>;
};

export class AiChatTracker {
	constructor(
		public messageId: string,
		public routeId: string,
		public userId: string,
	) {}

	async update(
		stage: number,
		status: "started" | "success" | "error",
		nodeName: string,
		partialResponse?: Partial<AiChatResponseData>,
		error?: string,
	) {
		const channel = `${CHAN_AI_SSE_PREFIX}${this.userId}:${this.routeId}`;

		await publishMessage(channel, {
			messageId: this.messageId,
			routeId: this.routeId,
			userId: this.userId,
			stage,
			status,
			nodeName,
			data: partialResponse,
			error,
		});
	}
}

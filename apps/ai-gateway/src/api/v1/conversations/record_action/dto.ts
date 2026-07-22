import { z } from "zod";

export const recordActionParamSchema = z.object({
	conversationId: z.string(),
});

export const recordActionBodySchema = z.object({
	chatId: z.string(),
	action: z.enum(["approve", "reject", "review"]),
	reviews: z.array(z.string()).optional(),
	rejectReason: z.string().optional(),
});

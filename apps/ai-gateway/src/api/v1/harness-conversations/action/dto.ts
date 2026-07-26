import { z } from "zod";

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
});

export const conversationActionEnum = z.enum(["pin", "unpin", "archive", "unarchive"]);

export const requestBodySchema = z.object({
	action: conversationActionEnum,
});

export const responseSchema = z.object({
	id: z.string(),
	pinned: z.boolean(),
	archived: z.boolean(),
	updatedAt: z.union([z.string(), z.date()]),
});

export type ConversationAction = z.infer<typeof conversationActionEnum>;

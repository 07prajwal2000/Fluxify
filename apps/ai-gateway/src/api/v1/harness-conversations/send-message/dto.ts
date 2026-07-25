import { z } from "zod";

export const locationSchema = z.object({
	where: z.enum(["route-canvas", "custom-block-canvas"]),
	id: z.uuidv7(),
});

export const requestBodySchema = z.object({
	/** Omit (or leave empty) to start a brand new conversation. */
	conversationId: z.string().min(1).optional(),
	query: z.string().min(1),
	location: locationSchema.optional(),
});

export const responseSchema = z.object({
	conversationId: z.string(),
	runId: z.string(),
});

export type SendMessageBody = z.infer<typeof requestBodySchema>;

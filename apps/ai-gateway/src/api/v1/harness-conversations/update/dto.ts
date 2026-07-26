import { z } from "zod";

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
});

export const requestBodySchema = z.object({
	title: z.string().min(1).max(255),
});

export const responseSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	updatedAt: z.union([z.string(), z.date()]),
});

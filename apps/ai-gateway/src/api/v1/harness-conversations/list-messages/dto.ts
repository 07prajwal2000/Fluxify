import { z } from "zod";

/** Fixed — the agent UI always loads history 20 at a time. */
export const PAGE_SIZE = 20;

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
});

export const queryParamsSchema = z.object({
	/** Opaque cursor from a previous response's `nextCursor`. Omit for the
	 *  newest page. */
	cursor: z.string().min(1).optional(),
});

export const messageSchema = z.object({
	id: z.string(),
	userQuery: z.string(),
	aiResponse: z.string().nullable(),
	status: z.string(),
	artifactId: z.string().nullable(),
	createdAt: z.union([z.string(), z.date()]),
	completedAt: z.union([z.string(), z.date()]).nullable(),
});

export const responseSchema = z.object({
	messages: z.array(messageSchema),
	pagination: z.object({
		/** Pass back as `cursor` to load the 20 messages older than this page.
		 *  Null when the conversation start has been reached. */
		nextCursor: z.string().nullable(),
		hasMore: z.boolean(),
	}),
});

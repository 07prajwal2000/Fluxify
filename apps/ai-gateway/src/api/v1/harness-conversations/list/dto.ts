import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "@fluxify/server/src/lib/pagination";

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
});

export const queryParamsSchema = z.clone(paginationRequestQuerySchema).extend({
	needUserQuery: z.coerce.boolean().default(false),
	/** Archived conversations are hidden unless explicitly asked for. */
	archived: z.coerce.boolean().default(false),
	/** When true, only pinned conversations are returned. */
	pinned: z.coerce.boolean().optional(),
	/** Case-insensitive substring match against the conversation title. */
	search: z.string().trim().min(1).optional(),
});

export const conversationSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	status: z.string(),
	pinned: z.boolean(),
	archived: z.boolean(),
	createdAt: z.union([z.string(), z.date()]),
	updatedAt: z.union([z.string(), z.date()]),
	userQuery: z.string().optional(),
});

export const responseSchema = z.object({
	data: z.array(conversationSchema),
	pagination: paginationResponseSchema,
});

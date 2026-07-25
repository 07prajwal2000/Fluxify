import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "@fluxify/server";

export const queryParamsSchema = z.clone(paginationRequestQuerySchema).extend({
	needUserQuery: z.coerce.boolean().default(false),
});

export const conversationSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	status: z.string(),
	createdAt: z.union([z.string(), z.date()]),
	updatedAt: z.union([z.string(), z.date()]),
	userQuery: z.string().optional(),
});

export const responseSchema = z.object({
	data: z.array(conversationSchema),
	pagination: paginationResponseSchema,
});

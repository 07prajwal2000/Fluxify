import { z } from "zod";

export const requestRouteSchema = z.object({
	id: z.string().min(1),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	description: z.string().nullable(),
	hidden: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

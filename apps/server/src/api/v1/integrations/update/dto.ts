import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	id: z.string(),
});

export const requestBodySchema = z.object({
	name: z.string(),
	config: z.any(),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	variant: z.string(),
	config: z.any(),
});

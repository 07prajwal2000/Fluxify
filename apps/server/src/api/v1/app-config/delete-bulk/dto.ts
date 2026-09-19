import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
});

export const requestBodySchema = z.object({
	ids: z.array(z.number().int().min(1)).min(1),
});

export const responseSchema = z.object({});

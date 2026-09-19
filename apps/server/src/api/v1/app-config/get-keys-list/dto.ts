import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
});

export const requestQuerySchema = z.object({
	search: z.string().min(1).max(25).optional(),
});

export const responseSchema = z.array(z.string());

import { z } from "zod";

export const requestRouteSchema = z.object({
	id: z.string().min(1),
});

export const responseSchema = z.object({
	id: z.string(),
});

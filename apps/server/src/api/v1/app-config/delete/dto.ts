import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	id: z.coerce.number().min(1),
});

export const responseSchema = z.unknown().optional();

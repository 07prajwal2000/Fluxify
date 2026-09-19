import { z } from "zod";
import { integrationsGroupSchema } from "../schemas";

export const requestRouteSchema = z.object({
	projectId: z.string(),
});

export const requestBodySchema = z.object({
	name: z.string(),
	group: integrationsGroupSchema,
	variant: z.string(),
	config: z.object({}),
});

export const responseSchema = z.object({
	id: z.string(),
});

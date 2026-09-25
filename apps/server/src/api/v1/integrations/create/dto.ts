import { z } from "zod";
import { integrationsGroupSchema } from "../schemas";

export const requestRouteSchema = z.object({
	projectId: z.string(),
});

export const requestBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(255),
	group: integrationsGroupSchema,
	variant: z.string(),
	config: z.object({}),
});

export const responseSchema = z.object({
	id: z.string(),
});

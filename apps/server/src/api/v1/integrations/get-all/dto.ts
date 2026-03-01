import { z } from "zod";
import { integrationsGroupSchema } from "../schemas";
export const requestRouteSchema = z.object({
	group: integrationsGroupSchema,
});

export const requestQuerySchema = z.object({
	tags: z.string().optional(),
});

export const responseSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		group: z.string(),
		variant: z.string(),
		config: z.object(),
		tags: z.array(z.string()).optional(),
	}),
);

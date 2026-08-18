import { z } from "zod";

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
});

export const queryParamsSchema = z.object({
	/** Raw text from the user — no operators, no syntax. */
	q: z.string().trim().min(1, "q is required").max(200),
});

export const resultSchema = z.object({
	type: z.enum(["route", "integration", "app_config", "custom_block"]),
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	path: z.string().optional(),
	method: z.string().optional(),
	group: z.string().optional(),
	variant: z.string().optional(),
	/** custom blocks only */
	label: z.string().optional(),
	inputParams: z.array(z.unknown()).optional(),
});

export const responseSchema = z.object({
	query: z.string(),
	results: z.array(resultSchema),
});

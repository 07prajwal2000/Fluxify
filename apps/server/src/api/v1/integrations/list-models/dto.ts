import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

export const requestBodySchema = z.object({
	variant: z.enum(["OpenAI", "Anthropic", "Gemini", "Mistral", "OpenAI Compatible"]),
	/** the form's config as typed so far: `cfg:` references allowed, `model` not needed */
	config: z
		.object({
			apiKey: z.string().optional(),
			baseUrl: z.string().optional(),
			headers: z.record(z.string(), z.string()).optional(),
		})
		.loose(),
	/** skip the server's cached copy */
	refresh: z.boolean().default(false),
});

export const responseSchema = z.object({
	models: z.array(
		z.object({
			id: z.string(),
			name: z.string().optional(),
			contextLength: z.number().optional(),
			/** USD per million tokens */
			pricing: z.object({ input: z.number(), output: z.number() }).optional(),
		}),
	),
	/** why the list is empty: the picker shows it and free text keeps working */
	error: z.string().optional(),
	cached: z.boolean().optional(),
});

import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

/** Every group the project can create, with its variants, built-ins first in their fixed order. */
export const responseSchema = z.array(
	z.object({
		group: z.string(),
		label: z.string(),
		builtIn: z.boolean(),
		/** a plugin's own group: its scope (`acme` for `acme/crm`) */
		namespace: z.string().optional(),
		variants: z.array(
			z.object({
				variant: z.string(),
				label: z.string(),
				icon: z.string().optional(),
				tags: z.array(z.string()),
				builtIn: z.boolean(),
				/** a plugin variant: the plugin that provides it (`acme/crm`) and its scope */
				plugin: z.string().optional(),
				namespace: z.string().optional(),
				/** databases only: editor for custom conditions */
				conditionEditor: z.enum(["sql", "js"]).optional(),
				/** plugin variants: the params that generate the form (and tabs) */
				params: z.record(z.string(), z.unknown()).optional(),
				tabs: z.array(z.string()).optional(),
				hasTest: z.boolean().optional(),
				hasDescribe: z.boolean().optional(),
				hasInspect: z.boolean().optional(),
				description: z.string().optional(),
				docs: z.string().optional(),
				/** json-schema of configSchema, for ai-gateway or tools */
				configSchema: z.record(z.string(), z.unknown()).optional(),
			}),
		),
	}),
);

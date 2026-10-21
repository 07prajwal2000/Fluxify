import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

/** Every registered group with its variants, built-ins first in their fixed order. */
export const responseSchema = z.array(
	z.object({
		group: z.string(),
		label: z.string(),
		builtIn: z.boolean(),
		variants: z.array(
			z.object({
				variant: z.string(),
				label: z.string(),
				icon: z.string().optional(),
				tags: z.array(z.string()),
				builtIn: z.boolean(),
				/** databases only: editor for custom conditions */
				conditionEditor: z.enum(["sql", "js"]).optional(),
			}),
		),
	}),
);

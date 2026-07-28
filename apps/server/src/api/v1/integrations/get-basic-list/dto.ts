import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
});

/** `useForHarness=true|false` narrows the list to `ai` integrations whose
 *  `config.useForHarness` matches (a missing attribute counts as false). */
export const requestQuerySchema = z.object({
	useForHarness: z.enum(["true", "false"]).optional(),
});

export const responseSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		group: z.string(),
		variant: z.string(),
	}),
);

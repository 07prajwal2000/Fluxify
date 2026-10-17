import z from "zod";

export const responseSchema = z.object({
	resourceTypes: z.array(z.string()),
	actions: z.array(z.string()),
	/** every project that has events, deleted ones included, with the name its events carry */
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string().nullable(),
			slug: z.string().nullable(),
			deleted: z.boolean(),
		}),
	),
});

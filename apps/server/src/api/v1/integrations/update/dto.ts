import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	id: z.string(),
});

export const requestBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(255),
	config: z.any(),
	/** omit to keep the current one, null to remove it */
	devConfig: z.any().optional(),
	syncDev: z.boolean().optional(),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	variant: z.string(),
	config: z.any(),
	devConfig: z.any().nullable(),
	syncDev: z.boolean(),
});

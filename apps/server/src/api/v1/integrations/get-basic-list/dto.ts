import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

export const responseSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		group: z.string(),
		variant: z.string(),
		hasDevConfig: z.boolean(),
		syncDev: z.boolean(),
	}),
);

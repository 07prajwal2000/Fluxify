import { z } from "zod";
import { integrationGroupNameSchema } from "../schemas";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

export const requestBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(255),
	group: integrationGroupNameSchema,
	variant: z.string(),
	config: z.object({}),
	/** development's own config, same shape as `config`; absent means none yet */
	devConfig: z.object({}).nullish(),
	/** development reads `config` instead of `devConfig` */
	syncDev: z.boolean().optional(),
});

export const responseSchema = z.object({
	id: z.string(),
});

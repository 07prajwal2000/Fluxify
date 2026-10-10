import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	id: z.uuidv7("Invalid integration id"),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	variant: z.string(),
	config: z.object(),
	/** development's own config; null while it has none */
	devConfig: z.object().nullable(),
	/** development reads `config` instead of `devConfig` */
	syncDev: z.boolean(),
});

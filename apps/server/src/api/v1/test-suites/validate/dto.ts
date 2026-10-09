import { z } from "zod";

export const requestRouteSchema = z.object({
	id: z.string(),
});

/** a response to check against instead of the suite's last run; leave a part out to skip its checks */
export const requestBodySchema = z
	.object({
		sample: z
			.object({
				status: z.number().int().optional(),
				headers: z.record(z.string(), z.string()).optional(),
				body: z.unknown().optional(),
				output: z.unknown().optional(),
			})
			.optional(),
	})
	.default({});

export const responseSchema = z.object({
	/** where the response came from; null when there was none to check against */
	source: z.enum(["sample", "last run"]).nullable(),
	/** how many checks could be looked at */
	checked: z.number(),
	problems: z.array(z.string()),
	message: z.string(),
});

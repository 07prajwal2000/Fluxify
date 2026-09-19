import { z } from "zod";

export const requestParamSchema = z.object({
	id: z.string(),
});

export const responseSchema = z.object({
	blocks: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			data: z.any(),
			position: z.object({
				x: z.number(),
				y: z.number(),
			}),
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			from: z.string(),
			to: z.string(),
			fromHandle: z.string(),
			toHandle: z.string(),
		}),
	),
});

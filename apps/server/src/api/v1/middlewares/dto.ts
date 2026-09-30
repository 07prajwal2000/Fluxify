import z from "zod";

const uniqueIds = (what: string) =>
	z
		.array(z.string())
		.refine((ids) => new Set(ids).size === ids.length, `Each ${what} can appear only once`);

export const idParamSchema = z.object({ id: z.string() });
export const listQuerySchema = z.object({ projectId: z.string() });

export const createBodySchema = z.object({
	projectId: z.string(),
	name: z.string().trim().min(1).max(255),
	description: z.string().optional(),
	/** custom block ids in run order */
	blocks: uniqueIds("custom block").optional(),
});

export const updateBodySchema = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: z.string().nullish(),
	/** custom block ids in run order; replaces the whole chain */
	blocks: uniqueIds("custom block").optional(),
});

export const routeMiddlewaresBodySchema = z.object({
	before: uniqueIds("middleware"),
	after: uniqueIds("middleware"),
});

export const idResponseSchema = z.object({ id: z.string() });

const middlewareSummary = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
});

const chainBlock = z.object({
	id: z.string(),
	name: z.string(),
	label: z.string(),
	description: z.string().nullable(),
	icon: z.string().nullable(),
	iconUrl: z.string().nullable(),
});

export const listResponseSchema = z.array(
	middlewareSummary.extend({
		updatedAt: z.string(),
		blocks: z.array(chainBlock),
		/** routes that attach it, before or after */
		routeCount: z.number(),
	}),
);

export const getResponseSchema = middlewareSummary.extend({
	projectId: z.string(),
	blocks: z.array(chainBlock),
});

export const routeMiddlewaresResponseSchema = z.object({
	before: z.array(middlewareSummary),
	after: z.array(middlewareSummary),
});

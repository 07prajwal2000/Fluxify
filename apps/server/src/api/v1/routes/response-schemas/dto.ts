import { z } from "zod";

export const routeParamSchema = z.object({ id: z.uuidv7() });

export const statusParamSchema = routeParamSchema.extend({
	statusCode: z.coerce.number().int().min(100).max(599),
});

/** Exactly one of the two; the service enforces it, so the 400 can say so in words. */
export const putBodySchema = z.object({
	schema: z.record(z.string(), z.unknown()).optional(),
	sample: z.unknown().optional(),
});

export const responseSchemaItem = z.object({
	statusCode: z.number().int(),
	schema: z.record(z.string(), z.unknown()),
	updatedAt: z.string(),
});

export const listResponseSchema = z.array(responseSchemaItem);

import { z } from "zod";

/**
 * A workflow has no path, method or request schemas — it is not addressed over
 * HTTP, and nothing validates what a trigger hands it. Whoever fires the
 * trigger owns the payload; the workflow reads what it needs and ignores the rest.
 */
export const requestBodySchema = z.object({
	name: z.string().min(2).max(255),
	description: z.string().max(2000).optional(),
	projectId: z.uuidv7(),
	// A background job is allowed to be slower than a request, but not endless.
	timeoutSeconds: z.number().int().min(30).max(3600).default(300),
	active: z.boolean().optional(),
	tracingEnabled: z.boolean().optional(),
	recordExecution: z.boolean().optional(),
});

export const responseSchema = z.object({ id: z.uuidv7() });

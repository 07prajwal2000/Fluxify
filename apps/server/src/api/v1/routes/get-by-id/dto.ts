import z from "zod";

export const requestRouteSchema = z.object({
	id: z.uuidv7(),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string().min(1).max(255),
	path: z.string(),
	active: z.boolean(),
	method: z.string(),
	projectId: z.string(),
	projectName: z.string(),
	bodySchema: z.any().optional(),
	querySchema: z.any().optional(),
	paramsSchema: z.any().optional(),
	createdAt: z.string(),
	createdBy: z.string(),
	updatedAt: z.string(),
});

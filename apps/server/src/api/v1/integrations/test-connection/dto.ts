import { z } from "zod";
import { integrationGroupNameSchema } from "../schemas";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

export const requestBodySchema = z.object({
	group: integrationGroupNameSchema,
	variant: z.string(),
	config: z.any(),
});

export const responseSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	/** connected, but something will not work (a MongoDB server with no replica set cannot run transactions) */
	warning: z.string().optional(),
	/** mcp only: what the server exposes */
	tools: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
});

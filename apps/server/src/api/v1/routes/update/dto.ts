import { HttpMethod } from "../../../../db/schema";
import { z } from "zod";
import { ROUTE_REGEX } from "../constants";
import { routeSchemaValidationRefinement } from "../schema-validator";
import { CONTENT_TYPES } from "../../../../lib/routeConfig";

export const requestBodySchema = z
	.object({
		name: z.string().min(2).max(255),
		path: z.string().min(1).regex(ROUTE_REGEX),
		method: z.enum(HttpMethod, "Must be a HTTP Method"),
		active: z.boolean(),
		bodySchema: z.any().optional(),
		querySchema: z.any().optional(),
		paramsSchema: z.any().optional(),
		timeoutSeconds: z.number().int().min(30).optional(),
		tracingEnabled: z.boolean().optional(),
		// Lives in `route_config`, not on the route row — patched separately below.
		acceptedContentTypes: z.array(z.enum(CONTENT_TYPES)).min(1).optional(),
	})
	.superRefine(routeSchemaValidationRefinement);

export const requestRouteSchema = z.object({
	id: z.uuidv7(),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	method: z.string(),
	timeoutSeconds: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

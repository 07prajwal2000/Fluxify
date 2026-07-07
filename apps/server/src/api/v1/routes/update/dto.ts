import { HttpMethod } from "../../../../db/schema";
import { z } from "zod";
import { ROUTE_REGEX } from "../constants";
import { routeSchemaValidationRefinement } from "../schema-validator";

export const requestBodySchema = z
	.object({
		name: z.string().min(2).max(255),
		path: z.string().min(1).regex(ROUTE_REGEX),
		method: z.enum(HttpMethod, "Must be a HTTP Method"),
		active: z.boolean(),
		bodySchema: z.any().optional(),
		querySchema: z.any().optional(),
		paramsSchema: z.any().optional(),
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
	createdAt: z.string(),
	updatedAt: z.string(),
});

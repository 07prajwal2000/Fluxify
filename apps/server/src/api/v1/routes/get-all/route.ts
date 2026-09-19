import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openApiOptions: DescribeRouteOptions = {
	operationId: "get-routes-list",
	description: "Returns a list of Routes sorted by createdAt with pagination details",
	tags: ["Routes"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		400: {
			description: "Pagination Query Params Validation Error",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		404: {
			description: "Route not found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list",
		describeRoute(openApiOptions),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) => {
			const query = ctx.req.valid("query");
			const acl = ctx.get("acl") || [];
			const result = await handleRequest(query, acl);
			return ctx.json(result);
		},
	);
}

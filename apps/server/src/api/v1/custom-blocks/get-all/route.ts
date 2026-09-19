import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Returns a list of custom blocks for a project",
	operationId: "get-custom-blocks-list",
	tags: ["Custom Blocks"],
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
			description: "Query Params Validation Error",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("viewer", { key: "projectId", source: "query" }),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) => {
			const query = ctx.req.valid("query");
			const result = await handleRequest(query);
			return ctx.json(result);
		},
	);
}

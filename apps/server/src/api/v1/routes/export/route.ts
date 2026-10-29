import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requestQuerySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Exports a route as a portable bundle: settings, canvas, response schemas, middlewares and, unless includeTests=false, its test suites.",
	operationId: "export-route",
	tags: ["Routes"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid id (uuidv7)",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		404: {
			description: "No record found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/:id/export",
		describeRoute(openapiRouteOptions),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id } = ctx.req.valid("param");
			const { includeTests } = ctx.req.valid("query");
			return ctx.json(await handleRequest(id, includeTests, ctx.get("acl") || []));
		},
	);
}

import { describeRoute, DescribeRouteOptions, resolver, validator } from "hono-openapi";
import { HonoServer } from "../../../../types";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Lists workflows, newest edit first",
	operationId: "get-workflows-list",
	tags: ["Workflows"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid data",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		403: {
			description: "Forbidden",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list",
		describeRoute(openapiRouteOptions),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await handleRequest(ctx.req.valid("query"), ctx.get("acl") || [])),
	);
}

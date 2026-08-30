import { describeRoute, DescribeRouteOptions, resolver, validator } from "hono-openapi";
import { HonoServer } from "../../../../types";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requireLoggedIn } from "../../../auth/middleware";
import { requestBodySchema, requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Patches a workflow",
	operationId: "update-workflow",
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
		404: {
			description: "Workflow not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
		409: {
			description: "Duplicate name",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.patch(
		"/:id",
		describeRoute(openapiRouteOptions),
		requireLoggedIn(),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await handleRequest(
					ctx.req.valid("param").id,
					ctx.req.valid("json"),
					ctx.get("acl") || [],
				),
			),
	);
}

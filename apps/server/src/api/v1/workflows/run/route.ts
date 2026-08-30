import { describeRoute, DescribeRouteOptions, resolver, validator } from "hono-openapi";
import { HonoServer } from "../../../../types";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requireLoggedIn } from "../../../auth/middleware";
import { requestBodySchema, requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Queues one run of a workflow",
	operationId: "run-workflow",
	tags: ["Workflows"],
	responses: {
		200: {
			description: "Queued",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid data, or the workflow is not active",
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
	},
};

export default function (app: HonoServer) {
	app.post(
		"/:id/run",
		describeRoute(openapiRouteOptions),
		requireLoggedIn(),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await handleRequest(
					ctx.req.valid("param").id,
					ctx.req.valid("json"),
					(ctx.get("user") as { id?: string } | undefined)?.id ?? "",
					ctx.get("acl") || [],
				),
			),
	);
}

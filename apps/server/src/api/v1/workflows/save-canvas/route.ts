import { describeRoute, DescribeRouteOptions, resolver, validator } from "hono-openapi";
import { HonoServer } from "../../../../types";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestBodyValidator } from "../../../../modules/canvas/blockDataValidator";
import { requestBodySchema, requestParamSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Applies canvas changes to a workflow",
	operationId: "save-workflow-canvas-state",
	tags: ["Workflows"],
	responses: {
		204: { description: "No content returned after successful operation" },
		400: {
			description: "Invalid ID/Data format or duplicate block found",
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
	app.put(
		"/:id/save-canvas",
		describeRoute(openapiRouteOptions),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		requestBodyValidator,
		async (ctx) => {
			await handleRequest(
				ctx.req.valid("param").id,
				ctx.req.valid("json"),
				ctx.get("acl") || [],
			);
			return ctx.body(null, 204);
		},
	);
}

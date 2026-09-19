import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../types";
import { requireRoleAccess } from "../middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "auth-list-users",
	description: "List all users",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Validation error",
			content: {
				"application/json": { schema: resolver(validationErrorSchema) },
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list-users",
		describeRoute(openapiRouteOptions),
		validator("query", requestBodySchema, zodErrorCallbackParser),
		requireRoleAccess("viewer"),
		async (ctx) => {
			const query = ctx.req.valid("query");
			const result = await handleRequest(query);
			return ctx.json(result);
		},
	);
}

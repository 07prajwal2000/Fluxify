import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../types";
import { requireSystemAdmin } from "../middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "auth-create-user",
	description: "Create a new user",
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
	app.post(
		"/create-user",
		describeRoute(openapiRouteOptions),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		requireSystemAdmin,
		async (ctx) => {
			const data = ctx.req.valid("json");
			const result = await handleRequest(data);
			return ctx.json(result);
		},
	);
}

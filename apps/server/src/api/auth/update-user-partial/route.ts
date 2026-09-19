import { zValidator } from "@hono/zod-validator";
import type { User } from "better-auth";
import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { validationErrorSchema } from "../../../errors/validationError";
import type { HonoServer } from "../../../types";
import { requireSystemAdmin } from "../middleware";
import { requestBodySchema, requestParamsSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "auth-update-user",
	description: "Update a user",
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
	app.patch(
		"/update-user/:userId",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		zValidator("param", requestParamsSchema),
		zValidator("json", requestBodySchema),
		async (c) => {
			const params = c.req.valid("param");
			const body = c.req.valid("json");
			const user = c.get("user") as User;

			const result = await handleRequest(user, params, body);

			const response = responseSchema.parse(result);

			return c.json(response);
		},
	);
}

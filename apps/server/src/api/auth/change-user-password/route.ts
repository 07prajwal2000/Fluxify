import { zValidator } from "@hono/zod-validator";
import { describeRoute, DescribeRouteOptions, resolver } from "hono-openapi";
import { validationErrorSchema } from "../../../errors/validationError";
import { HonoServer } from "../../../types";
import { requireSystemAdmin } from "../middleware";
import {
	requestBodySchema,
	requestParamsSchema,
	responseSchema,
} from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "auth-change-user-password",
	description: "Change a credential user's password",
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
		"/change-user-password/:userId",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		zValidator("param", requestParamsSchema),
		zValidator("json", requestBodySchema),
		async (c) => {
			const result = await handleRequest(
				c.req.valid("param"),
				c.req.valid("json"),
			);

			return c.json(responseSchema.parse(result));
		},
	);
}

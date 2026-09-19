import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import type { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";
import { responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Get simplified authentication settings: a single 'type' (traditional|sso) plus the SSO config, instead of the raw auth_config/sso_config pair.",
	operationId: "get-auth-settings",
	tags: ["Instance Settings"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		403: {
			description: "Forbidden",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get("/auth", describeRoute(openapiRouteOptions), requireSystemAdmin, async (c) => {
		const result = await handleRequest();
		return c.json(result);
	});
}

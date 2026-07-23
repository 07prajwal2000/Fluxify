import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
} from "hono-openapi";
import { responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get all instance settings",
	operationId: "get-all-instance-settings",
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
	app.get(
		"/",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		async (c) => {
			const result = await handleRequest();
			return c.json(result);
		},
	);
}

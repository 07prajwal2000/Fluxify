import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { errorSchema } from "../../../../../../errors/customError";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-settings-keys-list",
	description: "Get all project settings as key-value pairs",
	tags: ["Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		404: {
			description: "Project not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		async (c) => {
			const id = c.req.param("id")!;
			const result = await handleRequest(id);
			return c.json(result);
		},
	);
}

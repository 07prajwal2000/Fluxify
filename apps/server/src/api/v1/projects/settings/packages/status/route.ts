import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import { installStatus } from "../../../../../../modules/packages/service";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { statusResponseSchema } from "../dto";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-packages-status",
	description: "How far each live worker got installing the project's current packages",
	tags: ["Projects", "Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(statusResponseSchema) } },
		},
		400: {
			description: "Validation error",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/status",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		async (c) => {
			const id = c.req.param("id") as string;
			return c.json(await installStatus(id));
		},
	);
}

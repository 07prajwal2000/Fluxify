import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import { listPackages } from "../../../../../../modules/packages/service";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { packagesResponseSchema } from "../dto";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-packages-list",
	description: "List the project's npm packages and the versions they are pinned to",
	tags: ["Projects", "Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(packagesResponseSchema) } },
		},
		400: {
			description: "Validation error",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		async (c) => {
			const id = c.req.param("id") as string;
			return c.json(await listPackages(id));
		},
	);
}

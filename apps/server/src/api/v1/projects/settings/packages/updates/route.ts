import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import { checkUpdates } from "../../../../../../modules/packages/service";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { updatesResponseSchema } from "../dto";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-packages-updates",
	description: "Newer releases of the project's packages that the minimum release age allows",
	tags: ["Projects", "Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(updatesResponseSchema) } },
		},
		400: {
			description: "Validation error",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/updates",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		async (c) => {
			const id = c.req.param("id") as string;
			return c.json(await checkUpdates(id));
		},
	);
}

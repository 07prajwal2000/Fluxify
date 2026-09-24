import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import { changePackages } from "../../../../../../modules/packages/service";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { packagesResponseSchema, removeRequestSchema } from "../dto";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-packages-remove",
	description: "Remove npm packages from the project and roll the change out to every worker",
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
	app.post(
		"/remove",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		validator("json", removeRequestSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.param();
			return c.json(
				await changePackages(
					id,
					{ remove: c.req.valid("json").names },
					c.get("user")?.id ?? "system",
				),
			);
		},
	);
}

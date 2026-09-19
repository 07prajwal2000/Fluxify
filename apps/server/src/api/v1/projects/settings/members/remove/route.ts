import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../../../errors/customError";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-members-remove",
	description: "Remove a user from project's ACL",
	tags: ["Projects", "Project Settings"],
	responses: {
		204: {
			description: "Deleted",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Validation error",
			content: {
				"application/json": { schema: resolver(validationErrorSchema) },
			},
		},
		404: {
			description: "ACL not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.delete(
		"/remove/:userId",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.param();
			const params = c.req.valid("param");
			await handleRequest(id, params);
			return c.body(null, 204);
		},
	);
}

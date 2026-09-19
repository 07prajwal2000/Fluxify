import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../../../errors/customError";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { requestBodySchema, requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-members-update",
	description: "Update a user's role in project's ACL",
	tags: ["Projects", "Project Settings"],
	responses: {
		200: {
			description: "Updated",
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
	app.put(
		"/update/:userId",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.param();
			const params = c.req.valid("param");
			const body = c.req.valid("json");
			const result = await handleRequest(id, params, body);
			return c.json(result);
		},
	);
}

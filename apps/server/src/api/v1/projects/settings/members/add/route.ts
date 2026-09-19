import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-members-add",
	description: "Add a user to project's ACL with a role",
	tags: ["Projects", "Project Settings"],
	responses: {
		201: {
			description: "Created",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Validation error",
			content: {
				"application/json": { schema: resolver(validationErrorSchema) },
			},
		},
		409: {
			description: "Member already exists",
			content: {
				"application/json": { schema: resolver(validationErrorSchema) },
			},
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/add",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.param();
			const body = c.req.valid("json");
			const result = await handleRequest(id, body);
			return c.json(result, 201);
		},
	);
}

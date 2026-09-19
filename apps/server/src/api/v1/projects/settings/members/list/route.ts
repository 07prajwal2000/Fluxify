import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../../../errors/customError";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-members-list",
	description: "List users associated with a project with optional filters and pagination",
	tags: ["Projects", "Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Validation error",
			content: {
				"application/json": { schema: resolver(validationErrorSchema) },
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.param();
			const query = c.req.valid("query");
			const result = await handleRequest(id, query);
			return c.json(result);
		},
	);
}

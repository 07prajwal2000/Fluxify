import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../../../errors/customError";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../../types";
import { requireProjectAccess } from "../../../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	operationId: "project-settings-keys-upsert",
	description: "Create or update a project setting key-value pair",
	tags: ["Project Settings"],
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
		404: {
			description: "Project not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.put(
		"/",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const id = c.req.param("id")!;
			const body = c.req.valid("json");
			const result = await handleRequest(id, body);
			return c.json(result);
		},
	);
}

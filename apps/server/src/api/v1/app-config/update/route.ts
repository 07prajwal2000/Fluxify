import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Update app config",
	operationId: "update-app-config",
	tags: ["App Config"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		400: {
			description: "Validation/Regular Error",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		404: {
			description: "App config not found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		409: {
			description: "App config key already exists",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.put(
		"/:id",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId, id } = c.req.valid("param");
			const body = c.req.valid("json");
			const response = await handleRequest(projectId, id, body);
			return c.json(response);
		},
	);
}

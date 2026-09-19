import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import { requestBodyValidator } from "./middleware";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Create integration",
	operationId: "create-integration",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		404: {
			description: "Invalid request / App config key not found",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		409: {
			description: "Integration already exists",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		requestBodyValidator,
		async (c) => {
			const { projectId } = c.req.valid("param");
			const data = c.req.valid("json");
			const config = c.get("config" as never) as any;
			data.config = config;
			const result = await handleRequest(projectId, data);
			return c.json(result, 201);
		},
	);
}

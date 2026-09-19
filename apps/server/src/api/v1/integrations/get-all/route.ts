import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestQuerySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get all integrations by group",
	operationId: "get-all-integrations-by-group",
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
		400: {
			description: "Query validation error",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/list/:group",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId, group } = c.req.valid("param");
			const { tags } = c.req.valid("query");
			const result = await handleRequest(projectId, group, tags);
			return c.json(result);
		},
	);
}

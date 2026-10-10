import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requirePortalSession, requireProjectAccess } from "../../../auth/middleware";
import { requestQuerySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Test the existing integration by its ID, with its development credentials (`Same as production` integrations use the production ones)",
	operationId: "test-existing-integration",
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
			description: "Integration not found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

const productionRouteOptions: DescribeRouteOptions = {
	description:
		"Test an existing integration with its PRODUCTION credentials. Portal sessions only: personal access tokens, OAuth (MCP) and agent tokens are refused.",
	operationId: "test-existing-integration-production",
	tags: ["Integrations"],
	responses: openapiRouteOptions.responses,
};

export default function (app: HonoServer) {
	app.get(
		"/test-production-connection/:id",
		describeRoute(productionRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		requirePortalSession(),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const params = c.req.valid("param");
			const { signal } = c.req.valid("query");
			return c.json(await handleRequest(params, signal, "production"));
		},
	);
	app.get(
		"/test-existing-connection/:id",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const params = c.req.valid("param");
			const { signal } = c.req.valid("query");
			const result = await handleRequest(params, signal);
			return c.json(result);
		},
	);
}

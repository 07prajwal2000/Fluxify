import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestQuerySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get list of app config keys",
	operationId: "get-keys-list",
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
	},
};

export default function (app: HonoServer) {
	app.get(
		"/keys",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId } = c.req.valid("param");
			const { search } = c.req.valid("query");
			const keys = await handleRequest(projectId, search);
			return c.json(keys);
		},
	);
}

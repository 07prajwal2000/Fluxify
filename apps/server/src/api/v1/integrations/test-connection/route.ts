import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Test integration connection",
	operationId: "test-connection",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "The probe ran: `success: true`, or `success: false` with the reason it failed",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		400: { description: "The body or the config fields are invalid" },
	},
};

export default function (app: HonoServer) {
	app.post(
		"/test-connection",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId } = c.req.valid("param");
			const body = c.req.valid("json");
			const result = await handleRequest(projectId, body);
			// pass or fail, the probe ran: 200 with its result (#690); bad input is 400 above
			return c.json(result);
		},
	);
}

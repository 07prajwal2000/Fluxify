import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Delete multiple app configs by ids",
	operationId: "delete-app-configs-bulk",
	tags: ["App Config"],
	responses: {
		200: {
			description: "Successful deletion",
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
	},
};

export default function (app: HonoServer) {
	app.post(
		"/delete-bulk",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId } = c.req.valid("param");
			const body = c.req.valid("json");
			await handleRequest(projectId, body);
			return c.body(null, 200);
		},
	);
}

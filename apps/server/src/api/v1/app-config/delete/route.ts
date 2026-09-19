import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Delete app config by id",
	operationId: "delete-app-config-by-id",
	tags: ["App Config"],
	responses: {
		204: {
			description: "Successful deletion",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		400: {
			description: "Id validation error",
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
	},
};

export default function (app: HonoServer) {
	app.delete(
		"/:id",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId, id } = c.req.valid("param");
			await handleRequest(projectId, id);
			return c.body(null, 204);
		},
	);
}

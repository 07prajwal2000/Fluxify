import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestRouteSchema } from "../../routes/get-by-id/dto";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Update the project",
	operationId: "update-project",
	tags: ["Projects"],
	responses: {
		200: {
			description: "Update successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		404: {
			description: "No project found with id",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		409: {
			description: "Name conflict, if project with same name exists",
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
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const body = c.req.valid("json");
			const { id } = c.req.valid("param");
			const result = await handleRequest(id, body);
			return c.json(result);
		},
	);
}

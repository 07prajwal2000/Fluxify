import { Hono } from "hono";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "create a new project",
	operationId: "create-project",
	tags: ["Projects"],
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
			description: "Invalid json data",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		409: {
			description: "Name conflict. Project name should be unique",
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
		requireSystemAdmin,
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const data = c.req.valid("json");
			const result = await handleRequest(data);
			return c.json(result);
		},
	);
}

import { Hono } from "hono";
import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { requestQuerySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get basic list of all integrations",
	operationId: "get-basic-list-integrations",
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
		"/list-basic",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId } = c.req.valid("param");
			const { useForHarness } = c.req.valid("query");
			const result = await handleRequest(
				projectId,
				useForHarness === undefined ? undefined : useForHarness === "true",
			);
			return c.json(result);
		},
	);
}

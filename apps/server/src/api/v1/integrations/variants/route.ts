import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "The integration groups and variants this server offers, built-in and plugin",
	operationId: "get-integration-variants",
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
			description: "Path validation error",
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
		"/variants",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("viewer", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		(c) => c.json(handleRequest(c.req.valid("param").projectId)),
	);
}

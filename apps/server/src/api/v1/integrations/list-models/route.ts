import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"List the models an AI provider offers, for a config that may not be saved yet. Calls the provider with the key (`cfg:` references allowed); the key never reaches the browser. Cached on the server for 10 minutes unless `refresh` is true. A failure is a 200 with `error`.",
	operationId: "list-ai-models",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "The models, or an empty list with the reason",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/list-models",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => c.json(await handleRequest(c.req.valid("param").projectId, c.req.valid("json"))),
	);
}

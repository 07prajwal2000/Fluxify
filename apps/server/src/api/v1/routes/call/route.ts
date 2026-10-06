import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requestRouteSchema } from "../get-by-id/dto";
import { callBodySchema, callResultSchema, callRoute } from "./service";

const error = (description: string, schema: Parameters<typeof resolver>[0] = errorSchema) => ({
	description,
	content: { "application/json": { schema: resolver(schema) } },
});

export default function (app: HonoServer) {
	app.post(
		"/:id/call",
		describeRoute({
			description:
				"Sends one real HTTP request to the route and returns what it answered. Runs the route for real.",
			operationId: "call-route",
			tags: ["Routes"],
			responses: {
				200: {
					description: "The route's answer, or why it could not be reached",
					content: { "application/json": { schema: resolver(callResultSchema) } },
				},
				400: error("Invalid data or inactive route", validationErrorSchema),
				403: error("Forbidden"),
				404: error("Route not found"),
			},
		}),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", callBodySchema, zodErrorCallbackParser),
		async (c) =>
			c.json(
				await callRoute(
					c.req.valid("param").id,
					c.req.valid("json"),
					c.get("acl") || [],
					new URL(c.req.url).origin,
				),
			),
	);
}

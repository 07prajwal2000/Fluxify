import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Returns a Route if matching id exist",
	operationId: "get-route-by-id",
	tags: ["Routes"],
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
			description: "Invalid id (uuidv7)",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		404: {
			description: "No record found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/:id",
		describeRoute(openapiRouteOptions),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id } = ctx.req.valid("param");
			const acl = ctx.get("acl") || [];
			const result = await handleRequest(id, acl);
			return ctx.json(result);
		},
	);
}

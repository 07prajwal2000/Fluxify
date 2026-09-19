import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Creates a new custom block and returns the object with id.",
	operationId: "create-custom-block",
	tags: ["Custom Blocks"],
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
			description: "Invalid data",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		409: {
			description: "Duplicate name",
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
		requireProjectAccess("creator", { key: "projectId", source: "body" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const data = ctx.req.valid("json");
			const result = await handleRequest(data);
			return ctx.json(result);
		},
	);
}

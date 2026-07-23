import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get instance settings by category",
	operationId: "get-instance-settings-by-category",
	tags: ["Instance Settings"],
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
			description: "Validation Error",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		403: {
			description: "Forbidden",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		500: {
			description: "Internal Server Error",
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
		"/category/:category",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (c) => {
			const { category } = c.req.valid("param");
			const result = await handleRequest(category);
			return c.json(result);
		},
	);
}

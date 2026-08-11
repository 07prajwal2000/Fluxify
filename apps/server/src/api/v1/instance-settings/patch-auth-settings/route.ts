import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Set authentication type (traditional|sso) and partially patch the SSO config. Only the SSO keys sent are merged into the stored config — omitted keys keep their current value.",
	operationId: "patch-auth-settings",
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
	app.patch(
		"/auth",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const body = c.req.valid("json");
			const result = await handleRequest(body);
			return c.json(result);
		},
	);
}

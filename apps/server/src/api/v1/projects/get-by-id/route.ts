import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import type { AuthACL } from "../../../../db/schema";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireLoggedIn } from "../../../auth/middleware";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Get project by ID",
	operationId: "get-project-by-id",
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
			description: "Invalid project ID",
			content: {
				"application/json": {
					schema: resolver(validationErrorSchema),
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
		404: {
			description: "Project not found",
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
		requireLoggedIn(),
		async (c) => {
			const { id } = c.req.valid("param");
			const acl = (c.get("acl") || []) as AuthACL[];
			const user = c.get("user") as { isSystemAdmin?: boolean } | undefined;
			const result = await handleRequest(id, acl, Boolean(user?.isSystemAdmin));
			return c.json(result);
		},
	);
}

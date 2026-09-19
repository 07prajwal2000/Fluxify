import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireLoggedIn } from "../../../auth/middleware";
import { requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Deletes a custom block by id",
	operationId: "delete-custom-block",
	tags: ["Custom Blocks"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid id",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		403: {
			description: "Forbidden (lack of access or plugin source type)",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
		404: {
			description: "Not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.delete(
		"/:id",
		describeRoute(openapiRouteOptions),
		requireLoggedIn(),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id } = ctx.req.valid("param");
			const user = ctx.get("user") as any;
			const acl = ctx.get("acl") || [];
			const result = await handleRequest(id, user, acl);
			return ctx.json(result);
		},
	);
}

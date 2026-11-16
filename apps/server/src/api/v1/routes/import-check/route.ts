import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { routeConflicts } from "../../../../modules/transfer/handlers/route";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Deprecated, use POST /v1/transfer/route/import/check. Says whether a route about to be imported would clash with a route of the project by name or by method and path. Changes nothing.",
	operationId: "check-route-import",
	tags: ["Routes"],
	deprecated: true,
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid data",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/import/check",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "body" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, ...route } = ctx.req.valid("json");
			return ctx.json(await routeConflicts(projectId, route));
		},
	);
}

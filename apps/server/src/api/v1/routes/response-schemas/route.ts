import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import {
	deleteForRoute,
	listForRoute,
	putForRoute,
} from "../../../../modules/responseSchemas/service";
import type { HonoServer } from "../../../../types";
import {
	listResponseSchema,
	putBodySchema,
	responseSchemaItem,
	routeParamSchema,
	statusParamSchema,
} from "./dto";

const json = (schema: Parameters<typeof resolver>[0], description: string) => ({
	description,
	content: { "application/json": { schema: resolver(schema) } },
});

const failures = {
	400: json(validationErrorSchema, "Invalid data"),
	403: json(errorSchema, "Forbidden"),
	404: json(errorSchema, "Route not found"),
};

/**
 * One schema per route and status code, in the schema editor's format. These
 * are the working copy's; a committed version keeps its own copy.
 */
export default function (app: HonoServer) {
	app.get(
		"/:id/response-schemas",
		describeRoute({
			description: "Lists the response schemas saved for the route, one per status code",
			operationId: "list-route-response-schemas",
			tags: ["Routes"],
			responses: { 200: json(listResponseSchema, "Successful"), ...failures },
		}),
		validator("param", routeParamSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.valid("param");
			return c.json(await listForRoute(id, c.get("acl") || []));
		},
	);

	app.put(
		"/:id/response-schemas/:statusCode",
		describeRoute({
			description:
				"Saves the schema for a status code, replacing any existing one. Send `schema` (the schema editor's format) or `sample` (a JSON response body to infer the schema from).",
			operationId: "put-route-response-schema",
			tags: ["Routes"],
			responses: { 200: json(responseSchemaItem, "The saved schema"), ...failures },
		}),
		validator("param", statusParamSchema, zodErrorCallbackParser),
		validator("json", putBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { id, statusCode } = c.req.valid("param");
			return c.json(await putForRoute(id, statusCode, c.req.valid("json"), c.get("acl") || []));
		},
	);

	app.delete(
		"/:id/response-schemas/:statusCode",
		describeRoute({
			description: "Deletes the schema saved for a status code",
			operationId: "delete-route-response-schema",
			tags: ["Routes"],
			responses: { 204: { description: "Deleted" }, ...failures },
		}),
		validator("param", statusParamSchema, zodErrorCallbackParser),
		async (c) => {
			const { id, statusCode } = c.req.valid("param");
			await deleteForRoute(id, statusCode, c.get("acl") || []);
			return c.body(null, 204);
		},
	);
}

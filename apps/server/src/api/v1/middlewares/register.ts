import { describeRoute, resolver, validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoContext, HonoServer } from "../../../types";
import { requireLoggedIn, requireProjectAccess } from "../../auth/middleware";
import {
	createBodySchema,
	getResponseSchema,
	idParamSchema,
	idResponseSchema,
	listQuerySchema,
	listResponseSchema,
	routeMiddlewaresBodySchema,
	routeMiddlewaresResponseSchema,
	updateBodySchema,
} from "./dto";
import * as service from "./service";

/** OpenAPI description for one endpoint: a summary and its 200 body */
function doc(operationId: string, description: string, schema: z.ZodType) {
	return describeRoute({
		description,
		operationId,
		tags: ["Middlewares"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
		},
	});
}

const caller = (ctx: HonoContext) => ({ user: ctx.get("user") as any, acl: ctx.get("acl") || [] });
const id = validator("param", idParamSchema, zodErrorCallbackParser);

/**
 * Middlewares (#534): named chains of middleware custom blocks, and the routes'
 * lists of them. Both live here because they read and write the same tables.
 */
export default {
	name: "middlewares",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/middlewares");

		router.get(
			"/list",
			doc("get-middlewares-list", "Lists a project's middlewares", listResponseSchema),
			requireProjectAccess("viewer", { key: "projectId", source: "query" }),
			validator("query", listQuerySchema, zodErrorCallbackParser),
			async (ctx) => ctx.json(await service.list(ctx.req.valid("query").projectId)),
		);
		router.get(
			"/:id",
			doc("get-middleware", "Returns a middleware with its chain in run order", getResponseSchema),
			requireLoggedIn(),
			id,
			async (ctx) => ctx.json(await service.get(ctx.req.valid("param").id, caller(ctx))),
		);
		router.post(
			"/",
			doc("create-middleware", "Creates an empty middleware", idResponseSchema),
			requireProjectAccess("creator", { key: "projectId", source: "body" }),
			validator("json", createBodySchema, zodErrorCallbackParser),
			async (ctx) => ctx.json(await service.create(ctx.req.valid("json"))),
		);
		router.put(
			"/:id",
			doc("update-middleware", "Renames a middleware or replaces its chain", idResponseSchema),
			requireLoggedIn(),
			id,
			validator("json", updateBodySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await service.update(ctx.req.valid("param").id, ctx.req.valid("json"), caller(ctx)),
				),
		);
		router.delete(
			"/:id",
			doc(
				"delete-middleware",
				"Deletes a middleware and detaches it from routes",
				idResponseSchema,
			),
			requireLoggedIn(),
			id,
			async (ctx) => ctx.json(await service.remove(ctx.req.valid("param").id, caller(ctx))),
		);

		app.get(
			"/routes/:id/middlewares",
			doc(
				"get-route-middlewares",
				"A route's before and after middlewares, in run order",
				routeMiddlewaresResponseSchema,
			),
			requireLoggedIn(),
			id,
			async (ctx) => ctx.json(await service.getForRoute(ctx.req.valid("param").id, caller(ctx))),
		);
		app.put(
			"/routes/:id/middlewares",
			doc("set-route-middlewares", "Replaces a route's middlewares", idResponseSchema),
			requireLoggedIn(),
			id,
			validator("json", routeMiddlewaresBodySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await service.setForRoute(ctx.req.valid("param").id, ctx.req.valid("json"), caller(ctx)),
				),
		);
	},
};

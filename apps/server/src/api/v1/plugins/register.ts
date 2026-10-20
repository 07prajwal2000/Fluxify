import { describeRoute, resolver, validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import * as service from "../../../modules/plugins/service";
import type { HonoContext, HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import {
	approveBodySchema,
	environmentsBodySchema,
	listResponseSchema,
	nameParamSchema,
	pluginSchema,
	projectQuerySchema,
} from "./dto";

function doc(operationId: string, description: string, schema: z.ZodType) {
	return describeRoute({
		description,
		operationId,
		tags: ["Plugins"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
		},
	});
}

const caller = (ctx: HonoContext) => ({ user: ctx.get("user") as any, acl: ctx.get("acl") || [] });
const project = validator("query", projectQuerySchema, zodErrorCallbackParser);
const plugin = validator("param", nameParamSchema, zodErrorCallbackParser);
const viewer = requireProjectAccess("viewer", { key: "projectId", source: "query" });
/** the services check creator themselves too: P2 calls them without HTTP */
const creator = requireProjectAccess("creator", { key: "projectId", source: "query" });

/** `scope/name` from the path, and the project from the query */
const target = (ctx: HonoContext) => {
	const { scope, name } = ctx.req.param() as z.infer<typeof nameParamSchema>;
	return [ctx.req.query("projectId")!, `${scope}/${name}`] as const;
};

/**
 * A project's plugins (#857): read, approve, reject, and where they run.
 * Installing and upgrading arrive with the sources (P2).
 */
export default {
	name: "plugins",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/plugins");

		router.get(
			"/list",
			doc("get-plugins-list", "Lists a project's plugins", listResponseSchema),
			viewer,
			project,
			async (ctx) => ctx.json(await service.listPlugins(ctx.req.valid("query").projectId)),
		);
		router.get(
			"/:scope/:name",
			doc(
				"get-plugin",
				"A plugin: manifest, version, approval, permissions, environments and status",
				pluginSchema,
			),
			viewer,
			project,
			plugin,
			async (ctx) => ctx.json(await service.getPlugin(...target(ctx))),
		);
		router.post(
			"/:scope/:name/approve",
			doc(
				"approve-plugin",
				"Lets this version load, with the permissions its manifest asks for. Creator or above.",
				pluginSchema,
			),
			creator,
			project,
			plugin,
			validator("json", approveBodySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await service.approvePlugin(...target(ctx), caller(ctx), ctx.req.valid("json").integrity),
				),
		);
		router.post(
			"/:scope/:name/reject",
			doc("reject-plugin", "Stops every block of the plugin from loading", pluginSchema),
			creator,
			project,
			plugin,
			async (ctx) => ctx.json(await service.rejectPlugin(...target(ctx), caller(ctx))),
		);
		router.put(
			"/:scope/:name/environments",
			doc(
				"set-plugin-environments",
				"Switches the plugin on or off in development and in production",
				pluginSchema,
			),
			creator,
			project,
			plugin,
			validator("json", environmentsBodySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await service.setPluginEnvironments(...target(ctx), ctx.req.valid("json"), caller(ctx)),
				),
		);
	},
};

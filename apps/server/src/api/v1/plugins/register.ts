import { validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { pluginInstallStatus } from "../../../modules/plugins/installStatus";
import * as service from "../../../modules/plugins/service";
import type { HonoContext, HonoServer } from "../../../types";
import { caller, creator, doc, project, viewer } from "./common";
import {
	approveBodySchema,
	environmentsBodySchema,
	installStatusSchema,
	listResponseSchema,
	nameParamSchema,
	pluginSchema,
} from "./dto";
import { registerSourceRoutes } from "./sources";

const plugin = validator("param", nameParamSchema, zodErrorCallbackParser);

/** `scope/name` from the path, and the project from the query */
const target = (ctx: HonoContext) => {
	const { scope, name } = ctx.req.param() as z.infer<typeof nameParamSchema>;
	return [ctx.req.query("projectId")!, `${scope}/${name}`] as const;
};

/**
 * A project's plugins (#857): read, approve, reject, and where they run.
 * Adding one (#858) is in `sources.ts`.
 */
export default {
	name: "plugins",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/plugins");
		// before `/:scope/:name`, which would read `fs/discover` as a plugin
		registerSourceRoutes(router);

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
		router.get(
			"/:scope/:name/install-status",
			doc(
				"get-plugin-install-status",
				"How far each worker got installing the plugin; an error on any worker is recorded as the plugin's status",
				installStatusSchema,
			),
			viewer,
			project,
			plugin,
			async (ctx) => ctx.json(await pluginInstallStatus(...target(ctx))),
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

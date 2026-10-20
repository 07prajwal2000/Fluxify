import { validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { pluginInstallStatus } from "../../../modules/plugins/installStatus";
import { removePlugin } from "../../../modules/plugins/remove";
import * as service from "../../../modules/plugins/service";
import { upgradePreview } from "../../../modules/plugins/upgrade";
import { pluginUsage } from "../../../modules/plugins/usage";
import type { HonoContext, HonoServer } from "../../../types";
import { caller, creator, doc, project, viewer } from "./common";
import {
	approveBodySchema,
	environmentsBodySchema,
	installStatusSchema,
	listResponseSchema,
	nameParamSchema,
	pluginSchema,
	removeResponseSchema,
	upgradePreviewSchema,
	usageSchema,
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
		router.get(
			"/:scope/:name/usage",
			doc(
				"get-plugin-usage",
				"Every route, workflow and custom block using a block of the plugin, working copy and promoted version, with the params, handles and invoke mode of each node",
				usageSchema,
			),
			viewer,
			project,
			plugin,
			async (ctx) => ctx.json(await pluginUsage(...target(ctx))),
		);
		router.get(
			"/:scope/:name/upgrade-preview",
			doc(
				"get-plugin-upgrade-preview",
				"The pending version against the approved one it would replace: what is removed, changed, deprecated or newly asked for, and whether approving is blocked",
				upgradePreviewSchema,
			),
			viewer,
			project,
			plugin,
			async (ctx) => ctx.json(await upgradePreview(...target(ctx))),
		);
		router.delete(
			"/:scope/:name",
			doc(
				"delete-plugin",
				"Removes the plugin from the project. Refused (409, with the users) while anything uses one of its blocks. Creator or above.",
				removeResponseSchema,
			),
			creator,
			project,
			plugin,
			async (ctx) => ctx.json(await removePlugin(...target(ctx), caller(ctx))),
		);
		router.post(
			"/:scope/:name/approve",
			doc(
				"approve-plugin",
				"Lets this version load, with the permissions its manifest asks for. An upgrade that removes something the project uses is refused (409, with the diff). Creator or above.",
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

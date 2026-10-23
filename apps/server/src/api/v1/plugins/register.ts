import { validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { pluginInstallStatus } from "../../../modules/plugins/installStatus";
import { removePlugin } from "../../../modules/plugins/remove";
import { scanPlugin, scanProject } from "../../../modules/plugins/scanner";
import * as service from "../../../modules/plugins/service";
import { upgradePreview } from "../../../modules/plugins/upgrade";
import { pluginUsedBy } from "../../../modules/plugins/usage";
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
	const params = ctx.req.param() as { scope?: string; name?: string; plugin?: string };
	const fullName = params.plugin
		? decodeURIComponent(params.plugin)
		: `${params.scope}/${params.name}`;
	return [ctx.req.query("projectId")!, fullName] as const;
};

const paths = (suffix = "") => [`/:scope/:name${suffix}`, `/:plugin${suffix}`] as const;

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

		for (const p of paths("/install-status")) {
			router.get(
				p,
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
		}
		for (const p of paths("/usage")) {
			router.get(
				p,
				doc(
					"get-plugin-usage",
					"Everything using the plugin: its block nodes on routes, workflows and custom blocks (working copy and promoted version), its trigger rows, and the integrations of its kinds",
					usageSchema,
				),
				viewer,
				project,
				plugin,
				async (ctx) => ctx.json(await pluginUsedBy(...target(ctx))),
			);
		}
		for (const p of paths("/upgrade-preview")) {
			router.get(
				p,
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
		}
		router.post(
			"/scan",
			doc(
				"scan-plugins",
				"Checks every plugin of the project now. Creator or above.",
				listResponseSchema,
			),
			creator,
			project,
			async (ctx) => ctx.json(await scanProject(ctx.req.valid("query").projectId)),
		);
		for (const p of paths("/scan")) {
			router.post(
				p,
				doc(
					"scan-plugin",
					"Checks the plugin's source and its install on the workers now, and records the result. Creator or above.",
					pluginSchema,
				),
				creator,
				project,
				plugin,
				async (ctx) => ctx.json(await scanPlugin(...target(ctx))),
			);
		}
		for (const p of paths("/approve")) {
			router.post(
				p,
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
						await service.approvePlugin(
							...target(ctx),
							caller(ctx),
							ctx.req.valid("json").integrity,
						),
					),
			);
		}
		for (const p of paths("/reject")) {
			router.post(
				p,
				doc("reject-plugin", "Stops every block of the plugin from loading", pluginSchema),
				creator,
				project,
				plugin,
				async (ctx) => ctx.json(await service.rejectPlugin(...target(ctx), caller(ctx))),
			);
		}
		for (const p of paths("/environments")) {
			router.put(
				p,
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
		}
		for (const p of paths()) {
			router.get(
				p,
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
			router.delete(
				p,
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
		}
	},
};

import { validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import {
	installPluginDependencies,
	planPluginDependencies,
	resolveNpmPlugin,
} from "../../../modules/plugins/sources/dependencies";
import type { HonoServer } from "../../../types";
import { caller, creator, doc, paths, plugin, project, target } from "./common";
import { dependencyPlanSchema, npmBodySchema, npmResolveSchema } from "./dto";

/**
 * Plugin dependencies (#899): what installing a plugin would bring along,
 * shown to the creator before anything installs, and installing what an
 * already added plugin still lacks.
 */
export function registerDependencyRoutes(router: HonoServer) {
	router.post(
		"/npm/resolve",
		doc(
			"resolve-npm-plugin",
			"What adding a plugin from npm would install: the plugin, and each plugin it depends on that the project lacks or holds out of range, in install order. Nothing is installed. A cycle or a version conflict is a 409, a missing version a 400.",
			npmResolveSchema,
		),
		creator,
		project,
		validator("json", npmBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await resolveNpmPlugin(
					ctx.req.valid("query").projectId,
					ctx.req.valid("json").spec,
					caller(ctx),
				),
			),
	);
	for (const p of paths("/dependencies/plan")) {
		router.get(
			p,
			doc(
				"plan-plugin-dependencies",
				"The plugins this plugin depends on that the project lacks or holds out of range, and the versions installing them would add. Nothing is installed.",
				dependencyPlanSchema,
			),
			creator,
			project,
			plugin,
			async (ctx) => ctx.json(await planPluginDependencies(...target(ctx))),
		);
	}
	for (const p of paths("/dependencies/install")) {
		router.post(
			p,
			doc(
				"install-plugin-dependencies",
				"Installs the plugins this plugin depends on that the project lacks or holds out of range. Each waits for approval. Creator or above.",
				dependencyPlanSchema,
			),
			creator,
			project,
			plugin,
			async (ctx) => ctx.json(await installPluginDependencies(...target(ctx), caller(ctx))),
		);
	}
}

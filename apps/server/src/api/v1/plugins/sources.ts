import { bodyLimit } from "hono/body-limit";
import { validator } from "hono-openapi";
import z from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { uploadPlugin } from "../../../modules/plugins/sources/archive";
import { addFsPlugin, discoverFsPlugins } from "../../../modules/plugins/sources/fs";
import { MAX_TARBALL_BYTES } from "../../../modules/plugins/sources/limits";
import { addNpmPlugin } from "../../../modules/plugins/sources/npm";
import {
	fetchApprovedUrl,
	listUrlRequests,
	requestUrlFetch,
} from "../../../modules/plugins/sources/url";
import type { HonoContext, HonoServer } from "../../../types";
import { caller, creator, doc, project, viewer } from "./common";
import {
	fsBodySchema,
	fsCandidatesSchema,
	npmBodySchema,
	pluginSchema,
	urlBodySchema,
	urlParamSchema,
	urlRequestSchema,
} from "./dto";

const projectOf = (ctx: HonoContext) => ctx.req.query("projectId")!;

/**
 * Adding a plugin to a project (#858): `upload`, `npm`, `url` (two steps) and
 * `fs`. Each ends in the registry's `registerPluginVersion`, so a new plugin is
 * pending until a creator approves it. Must be registered before the
 * `/:scope/:name` routes: `fs/discover` would otherwise read as a plugin name.
 */
export function registerSourceRoutes(router: HonoServer) {
	router.post(
		"/upload",
		doc(
			"upload-plugin",
			"Adds a plugin from a .tgz built by fluxify-cli (multipart field `file`). It waits for approval.",
			pluginSchema,
		),
		creator,
		project,
		// a little over the file itself: the multipart envelope
		bodyLimit({
			maxSize: MAX_TARBALL_BYTES + 1024 * 1024,
			onError: (ctx) => ctx.json({ message: "The upload is too large" }, 413),
		}),
		async (ctx) => {
			const file = (await ctx.req.parseBody()).file;
			if (!(file instanceof File))
				throw new BadRequestError("Send the plugin as the multipart field `file`");
			return ctx.json(
				await uploadPlugin(projectOf(ctx), new Uint8Array(await file.arrayBuffer()), caller(ctx)),
			);
		},
	);
	router.post(
		"/npm",
		doc(
			"add-npm-plugin",
			"Adds a plugin from npm at an exact version. It waits for approval.",
			pluginSchema,
		),
		creator,
		project,
		validator("json", npmBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await addNpmPlugin(projectOf(ctx), ctx.req.valid("json").spec, caller(ctx))),
	);

	router.post(
		"/url",
		doc(
			"request-plugin-url",
			"Step 1 of adding a plugin from a URL on a trusted domain: records it. Nothing is downloaded until step 2.",
			urlRequestSchema,
		),
		creator,
		project,
		validator("json", urlBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await requestUrlFetch(projectOf(ctx), ctx.req.valid("json").url, caller(ctx))),
	);
	router.get(
		"/url/list",
		doc("get-plugin-url-requests", "A project's plugin URL requests", z.array(urlRequestSchema)),
		viewer,
		project,
		async (ctx) => ctx.json(await listUrlRequests(projectOf(ctx))),
	);
	router.post(
		"/url/:id/fetch",
		doc(
			"fetch-plugin-url",
			"Step 2: lets the admin download the URL, validate and store it. The plugin then waits for approval.",
			pluginSchema,
		),
		creator,
		project,
		validator("param", urlParamSchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await fetchApprovedUrl(projectOf(ctx), ctx.req.valid("param").id, caller(ctx))),
	);

	router.get(
		"/fs/discover",
		doc(
			"discover-fs-plugins",
			"Lists the plugin directories under the instance's plugins directory",
			fsCandidatesSchema,
		),
		creator,
		project,
		async (ctx) => ctx.json(await discoverFsPlugins()),
	);
	router.post(
		"/fs",
		doc(
			"add-fs-plugin",
			"Adds a plugin from a directory listed by fs/discover. It waits for approval.",
			pluginSchema,
		),
		creator,
		project,
		validator("json", fsBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await addFsPlugin(projectOf(ctx), ctx.req.valid("json").path, caller(ctx))),
	);
}

import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import {
	inspectArchive,
	MAX_ARCHIVE_UPLOAD_BYTES,
	restoreProject,
} from "../../../../modules/projectBackup/restoreProject";
import type { HonoContext, HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";
import { inspectResponseSchema, newProjectSchema, restoreResponseSchema } from "./dto";

const doc = (operationId: string, description: string, schema: z.ZodType) =>
	describeRoute({
		description,
		operationId,
		tags: ["Projects"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
			400: { description: "The archive is refused; the message says why" },
			409: { description: "A project already has that name or slug" },
			413: { description: "The archive is larger than the upload limit" },
		},
	});

const limit = bodyLimit({
	// a little over the archive itself: the multipart envelope
	maxSize: MAX_ARCHIVE_UPLOAD_BYTES + 1024 * 1024,
	onError: (ctx) =>
		ctx.json(
			{
				message: `The file is larger than ${MAX_ARCHIVE_UPLOAD_BYTES / 1024 / 1024} MB, the upload limit.`,
			},
			413,
		),
});

/** a template's web sources are fetched inside a restore call: lift Bun's idle cut-off */
export function noIdleTimeout(ctx: HonoContext) {
	(ctx.env as { timeout?(request: Request, seconds: number): void } | undefined)?.timeout?.(
		ctx.req.raw,
		0,
	);
}

async function readUpload(ctx: HonoContext) {
	const body = await ctx.req.parseBody();
	if (!(body.file instanceof File))
		throw new BadRequestError("Send the archive as the multipart field `file`");
	return { body, bytes: new Uint8Array(await body.file.arrayBuffer()) };
}

/**
 * A new project from a backup or template file (#1104). Inspect checks the whole
 * archive and writes nothing; restore checks it again, then creates the project.
 * The same permission as creating a project.
 */
export default function (app: HonoServer) {
	app.post(
		"/restore/inspect",
		doc(
			"inspect-project-archive",
			"Checks a backup or template archive (multipart field `file`) and returns what it holds",
			inspectResponseSchema,
		),
		requireSystemAdmin,
		limit,
		async (ctx) => ctx.json(await inspectArchive((await readUpload(ctx)).bytes)),
	);
	app.post(
		"/restore",
		doc(
			"restore-project",
			"Creates a project from a backup or template archive (multipart fields `file`, `name`, and optionally `slug`, `description`, `subdomain`)",
			restoreResponseSchema,
		),
		requireSystemAdmin,
		limit,
		async (ctx) => {
			noIdleTimeout(ctx);
			const { body, bytes } = await readUpload(ctx);
			// a blank optional field arrives as ""
			const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
			const fields = newProjectSchema.safeParse({
				name: body.name,
				slug: blank(body.slug),
				description: blank(body.description),
				subdomain: blank(body.subdomain),
			});
			if (!fields.success) return zodErrorCallbackParser(fields, ctx);
			const { projectId, warnings } = await restoreProject(bytes, fields.data);
			return ctx.json({ id: projectId, warnings });
		},
	);
}

import { describeRoute, resolver, validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import {
	idParamSchema,
	idResponseSchema,
	listResponseSchema,
	projectParamSchema,
	sectionsResponseSchema,
	startBodySchema,
} from "./dto";
import * as service from "./service";

function doc(operationId: string, description: string, schema?: z.ZodType) {
	return describeRoute({
		description,
		operationId,
		tags: ["Backups"],
		responses: {
			200: {
				description: "Successful",
				content: schema
					? { "application/json": { schema: resolver(schema) } }
					: { "application/gzip": { schema: { type: "string", format: "binary" } } },
			},
		},
	});
}

// a backup holds the whole project, secrets included in a sealed form: creators and above
const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });
const project = validator("param", projectParamSchema, zodErrorCallbackParser);
const id = validator("param", idParamSchema, zodErrorCallbackParser);
const body = validator("json", startBodySchema, zodErrorCallbackParser);

/**
 * Manual project backups (#1103): start one, list the history, download a
 * finished archive. The run happens on the admin after the response.
 */
export default {
	name: "backups",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/:projectId/backups");

		router.get(
			"/sections",
			doc(
				"get-backup-sections",
				"Lists the resource sections a backup can hold",
				sectionsResponseSchema,
			),
			creator,
			project,
			(c) => c.json(service.sections()),
		);
		router.get(
			"/",
			doc("get-backups", "Lists a project's backup history, newest first", listResponseSchema),
			creator,
			project,
			async (c) => c.json(await service.list(c.req.valid("param").projectId)),
		);
		router.post(
			"/",
			doc("start-backup", "Starts a manual backup and returns its history row", idResponseSchema),
			creator,
			project,
			body,
			async (c) => {
				const user = c.get("user") as { id: string } | undefined;
				const { id: backupId } = await service.start(
					c.req.valid("param").projectId,
					user?.id ?? null,
					c.req.valid("json"),
				);
				return c.json({ id: backupId });
			},
		);
		router.get(
			"/:id/download",
			doc("download-backup", "Downloads a finished manual backup (.tar.gz)"),
			creator,
			id,
			async (c) => {
				const p = c.req.valid("param");
				const { bytes, filename } = await service.download(p.projectId, p.id);
				return new Response(bytes, {
					headers: {
						"content-type": "application/gzip",
						"content-length": String(bytes.length),
						"content-disposition": `attachment; filename="${filename}"`,
						"cache-control": "no-store",
					},
				});
			},
		);
	},
};

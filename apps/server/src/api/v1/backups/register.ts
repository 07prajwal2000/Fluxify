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
	scheduleBodySchema,
	scheduleResponseSchema,
	sectionsResponseSchema,
	startBodySchema,
} from "./dto";
import { registerRemoteBackups } from "./remote";
import * as schedule from "./schedule";
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
const scheduleBody = validator("json", scheduleBodySchema, zodErrorCallbackParser);
const userId = (c: { get(key: "user"): unknown }) =>
	(c.get("user") as { id: string } | undefined)?.id ?? null;

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
				const { id: backupId } = await service.start(
					c.req.valid("param").projectId,
					userId(c),
					c.req.valid("json"),
				);
				return c.json({ id: backupId });
			},
		);
		// backups to object storage (#1106, EE): settings, and "Back up now"
		router.get(
			"/schedule",
			doc(
				"get-backup-schedule",
				"Reads the project's backup to object storage settings and its last run",
				scheduleResponseSchema,
			),
			creator,
			project,
			async (c) => c.json(await schedule.getSchedule(c.req.valid("param").projectId)),
		);
		router.put(
			"/schedule",
			doc(
				"put-backup-schedule",
				"Saves the project's backup to object storage settings (Enterprise)",
				scheduleResponseSchema,
			),
			creator,
			project,
			scheduleBody,
			async (c) =>
				c.json(await schedule.saveSchedule(c.req.valid("param").projectId, c.req.valid("json"))),
		);
		router.post(
			"/object-storage",
			doc(
				"start-object-storage-backup",
				"Backs the project up to its Object Storage integration now (Enterprise)",
				idResponseSchema,
			),
			creator,
			project,
			async (c) => {
				const run = await schedule.backupNow(c.req.valid("param").projectId, userId(c));
				return c.json({ id: run.id });
			},
		);
		registerRemoteBackups(router);
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

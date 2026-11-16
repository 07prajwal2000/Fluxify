import { describeRoute, resolver, validator } from "hono-openapi";
import type { z } from "zod";
import { assertCanRunStorageBackups } from "../../../lib/edition";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import {
	downloadRemoteArchive,
	listBackupPrefixes,
	listRemoteBackups,
} from "../../../modules/projectBackup/remote";
import { inspectArchive, restoreProject } from "../../../modules/projectBackup/restoreProject";
import type { HonoServer } from "../../../types";
import { requireProjectAccess, requireSystemAdmin } from "../../auth/middleware";
import { inspectResponseSchema, restoreResponseSchema } from "../projects/restore/dto";
import { noIdleTimeout } from "../projects/restore/route";
import {
	prefixesQuerySchema,
	prefixesResponseSchema,
	projectParamSchema,
	remoteKeySchema,
	remoteListResponseSchema,
	remoteQuerySchema,
	remoteRestoreBodySchema,
} from "./dto";

const doc = (operationId: string, description: string, schema: z.ZodType) =>
	describeRoute({
		description,
		operationId,
		tags: ["Backups"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
			400: { description: "The bucket or the archive is refused; the message says why" },
		},
	});

const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });
const project = validator("param", projectParamSchema, zodErrorCallbackParser);
const keyBody = validator("json", remoteKeySchema, zodErrorCallbackParser);

/**
 * Backups read back from this project's Object Storage integration (#1107,
 * Enterprise, through the grace period). Listing needs the project; inspecting
 * and restoring create a project elsewhere, so they need a system admin, as
 * the file upload does (#1104). Restoring always makes a new project.
 */
export function registerRemoteBackups(router: ReturnType<HonoServer["basePath"]>) {
	router.get(
		"/remote/prefixes",
		doc(
			"get-remote-backup-prefixes",
			"Lists the folders in the integration's bucket that hold backups",
			prefixesResponseSchema,
		),
		creator,
		project,
		validator("query", prefixesQuerySchema, zodErrorCallbackParser),
		async (c) => {
			assertCanRunStorageBackups();
			const { integrationId } = c.req.valid("query");
			const prefixes = await listBackupPrefixes(c.req.valid("param").projectId, integrationId);
			return c.json({ prefixes });
		},
	);
	router.get(
		"/remote",
		doc(
			"get-remote-backups",
			"Lists the complete backups under a prefix of the integration's bucket, newest first",
			remoteListResponseSchema,
		),
		creator,
		project,
		validator("query", remoteQuerySchema, zodErrorCallbackParser),
		async (c) => {
			assertCanRunStorageBackups();
			const { integrationId, prefix } = c.req.valid("query");
			const projectId = c.req.valid("param").projectId;
			return c.json({ backups: await listRemoteBackups(projectId, integrationId, prefix) });
		},
	);
	router.post(
		"/remote/inspect",
		doc(
			"inspect-remote-backup",
			"Downloads a backup from the bucket, checks it and returns what it holds; creates nothing",
			inspectResponseSchema,
		),
		creator,
		requireSystemAdmin,
		project,
		keyBody,
		async (c) => {
			assertCanRunStorageBackups();
			const { integrationId, key } = c.req.valid("json");
			const bytes = await downloadRemoteArchive(c.req.valid("param").projectId, integrationId, key);
			return c.json(await inspectArchive(bytes));
		},
	);
	router.post(
		"/remote/restore",
		doc(
			"restore-remote-backup",
			"Creates a new project from a backup in the bucket",
			restoreResponseSchema,
		),
		creator,
		requireSystemAdmin,
		project,
		validator("json", remoteRestoreBodySchema, zodErrorCallbackParser),
		async (c) => {
			assertCanRunStorageBackups();
			noIdleTimeout(c);
			const { integrationId, key, ...fields } = c.req.valid("json");
			const bytes = await downloadRemoteArchive(c.req.valid("param").projectId, integrationId, key);
			const { projectId, warnings } = await restoreProject(bytes, fields);
			return c.json({ id: projectId, warnings });
		},
	);
}

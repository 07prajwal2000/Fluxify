import { describeRoute, resolver, validator } from "hono-openapi";
import type { z } from "zod";
import { assertCanRunStorageBackups } from "../../../lib/edition";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { downloadRemoteArchive } from "../../../modules/projectBackup/remote";
import { inspectRollback, rollbackProject } from "../../../modules/projectBackup/rollback";
import type { HonoContext, HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import { noIdleTimeout, readUpload, uploadLimit } from "../projects/restore/route";
import {
	projectParamSchema,
	remoteKeySchema,
	remoteRollbackBodySchema,
	rollbackChoiceSchema,
	rollbackInspectResponseSchema,
	rollbackResponseSchema,
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
			400: {
				description:
					"The archive or the choices are refused, or the backup taken first failed; nothing was changed",
			},
			409: { description: "A backup of this project is running" },
		},
	});

// it changes this project only and creates nothing new: the same as the backup endpoints
const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });
const project = validator("param", projectParamSchema, zodErrorCallbackParser);
const userId = (c: HonoContext) => (c.get("user") as { id: string } | undefined)?.id ?? null;

/** the choices as multipart fields: `mode`, `sections` (comma separated), `restoreSecrets` */
async function readChoice(c: HonoContext) {
	const { body, bytes } = await readUpload(c);
	const parsed = rollbackChoiceSchema.safeParse({
		mode: body.mode,
		sections: String(body.sections ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		restoreSecrets: body.restoreSecrets === "true",
	});
	return { parsed, bytes };
}

const choiceOf = ({ mode, sections, restoreSecrets }: z.infer<typeof rollbackChoiceSchema>) => ({
	sections,
	prune: mode === "exact",
	restoreSecrets,
});

/**
 * Rolling a project back in place to a backup (#1130), from an uploaded file or
 * a backup in the project's bucket. Inspect writes nothing; the rollback backs
 * the project up first and changes nothing if that fails.
 */
export function registerRollback(router: ReturnType<HonoServer["basePath"]>) {
	router.post(
		"/rollback/inspect",
		doc(
			"inspect-rollback",
			"Checks an archive (multipart field `file`) and returns what rolling this project back to it would change",
			rollbackInspectResponseSchema,
		),
		creator,
		project,
		uploadLimit,
		async (c) => {
			const { bytes } = await readUpload(c);
			return c.json(await inspectRollback(c.req.valid("param").projectId, bytes));
		},
	);
	router.post(
		"/rollback",
		doc(
			"rollback-project",
			"Rolls this project back to an archive (multipart fields `file`, `mode`, `sections` comma separated, `restoreSecrets`)",
			rollbackResponseSchema,
		),
		creator,
		project,
		uploadLimit,
		async (c) => {
			noIdleTimeout(c);
			const { parsed, bytes } = await readChoice(c);
			if (!parsed.success) return zodErrorCallbackParser(parsed, c);
			const projectId = c.req.valid("param").projectId;
			return c.json(await rollbackProject(projectId, bytes, choiceOf(parsed.data), userId(c)));
		},
	);
	router.post(
		"/remote/rollback/inspect",
		doc(
			"inspect-remote-rollback",
			"Downloads a backup from the bucket and returns what rolling this project back to it would change",
			rollbackInspectResponseSchema,
		),
		creator,
		project,
		validator("json", remoteKeySchema, zodErrorCallbackParser),
		async (c) => {
			assertCanRunStorageBackups();
			const { integrationId, key } = c.req.valid("json");
			const projectId = c.req.valid("param").projectId;
			const bytes = await downloadRemoteArchive(projectId, integrationId, key);
			return c.json(await inspectRollback(projectId, bytes));
		},
	);
	router.post(
		"/remote/rollback",
		doc(
			"remote-rollback-project",
			"Rolls this project back to a backup in the bucket",
			rollbackResponseSchema,
		),
		creator,
		project,
		validator("json", remoteRollbackBodySchema, zodErrorCallbackParser),
		async (c) => {
			assertCanRunStorageBackups();
			noIdleTimeout(c);
			const { integrationId, key, ...choice } = c.req.valid("json");
			const projectId = c.req.valid("param").projectId;
			const bytes = await downloadRemoteArchive(projectId, integrationId, key);
			return c.json(await rollbackProject(projectId, bytes, choiceOf(choice), userId(c)));
		},
	);
}

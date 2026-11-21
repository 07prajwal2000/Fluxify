import { eq } from "drizzle-orm";
import { describeRoute, resolver, validator } from "hono-openapi";
import type { z } from "zod";
import { db } from "../../../db";
import { projectsEntity } from "../../../db/schema";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { audit } from "../../../modules/audit";
import {
	listGitCommits,
	openGitCommit,
	readGitSettings,
	startGitCommit,
	writeGitSettings,
} from "../../../modules/projectBackup/gitRun";
import { gitSettingsSchema } from "../../../modules/projectBackup/gitSettings";
import { inspectArchive, restoreProject } from "../../../modules/projectBackup/restoreProject";
import type { HonoServer } from "../../../types";
import { requireProjectAccess, requireSystemAdmin } from "../../auth/middleware";
import { inspectResponseSchema, restoreResponseSchema } from "../projects/restore/dto";
import { noIdleTimeout } from "../projects/restore/route";
import {
	gitCommitBodySchema,
	gitCommitsResponseSchema,
	gitRestoreBodySchema,
	gitSettingsResponseSchema,
	gitShaSchema,
	idResponseSchema,
	projectParamSchema,
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
					"The repository, the credentials or the backup is refused; the message says why",
			},
		},
	});

const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });
const project = validator("param", projectParamSchema, zodErrorCallbackParser);
const json = <T extends z.ZodType>(schema: T) => validator("json", schema, zodErrorCallbackParser);

async function view(projectId: string) {
	const [settings, [row]] = await Promise.all([
		readGitSettings(projectId),
		db
			.select({ slug: projectsEntity.slug })
			.from(projectsEntity)
			.where(eq(projectsEntity.id, projectId)),
	]);
	return { settings, defaultPath: row?.slug ?? "" };
}

/**
 * Commits to a git repository (#1150, every edition, manual only). The
 * settings, "Commit to git" and the commit list need the project; inspecting
 * and restoring a commit create a project elsewhere, so they need a system
 * admin, as the other restores do. Restoring always makes a new project.
 */
export function registerGitBackups(router: ReturnType<HonoServer["basePath"]>) {
	router.get(
		"/git",
		doc(
			"get-git-backup-settings",
			"Reads where the project's git commits go",
			gitSettingsResponseSchema,
		),
		creator,
		project,
		async (c) => c.json(await view(c.req.valid("param").projectId)),
	);
	router.put(
		"/git",
		doc(
			"put-git-backup-settings",
			"Saves where the project's git commits go",
			gitSettingsResponseSchema,
		),
		creator,
		project,
		json(gitSettingsSchema),
		async (c) => {
			const { projectId } = c.req.valid("param");
			await db.transaction(async (tx) => {
				await writeGitSettings(projectId, c.req.valid("json"), tx);
				await audit.record({
					projectId,
					resourceType: "project",
					resourceId: projectId,
					action: "update",
					changedFields: ["backupGit"],
				});
			});
			return c.json(await view(projectId));
		},
	);
	router.post(
		"/git/commit",
		doc(
			"commit-git-backup",
			"Backs the project up as one commit on the branch; returns the history row",
			idResponseSchema,
		),
		creator,
		project,
		json(gitCommitBodySchema),
		async (c) => {
			const userId = (c.get("user") as { id: string } | undefined)?.id ?? null;
			const { projectId } = c.req.valid("param");
			const run = await startGitCommit(projectId, userId, c.req.valid("json").message);
			return c.json({ id: run.id });
		},
	);
	router.get(
		"/git/commits",
		doc(
			"get-git-backup-commits",
			"Lists the branch's newest commits, newest first",
			gitCommitsResponseSchema,
		),
		creator,
		project,
		async (c) => c.json({ commits: await listGitCommits(c.req.valid("param").projectId) }),
	);
	router.post(
		"/git/inspect",
		doc(
			"inspect-git-backup",
			"Reads the backup in a commit, checks it and returns what it holds; creates nothing",
			inspectResponseSchema,
		),
		creator,
		requireSystemAdmin,
		project,
		json(gitShaSchema),
		async (c) => {
			const source = await openGitCommit(c.req.valid("param").projectId, c.req.valid("json").sha);
			return c.json(await inspectArchive(source));
		},
	);
	router.post(
		"/git/restore",
		doc(
			"restore-git-backup",
			"Creates a new project from the backup in a commit",
			restoreResponseSchema,
		),
		creator,
		requireSystemAdmin,
		project,
		json(gitRestoreBodySchema),
		async (c) => {
			noIdleTimeout(c);
			const { sha, ...fields } = c.req.valid("json");
			const source = await openGitCommit(c.req.valid("param").projectId, sha);
			const { projectId, warnings } = await restoreProject(source, fields);
			return c.json({ id: projectId, warnings });
		},
	);
}

import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { GitRemote } from "../../../../modules/projectBackup/gitRepo";
import {
	gitBranchSchema,
	gitPathSchema,
	gitUrlSchema,
} from "../../../../modules/projectBackup/gitSettings";
import { listCommits, openCommit } from "../../../../modules/projectBackup/gitSource";
import { inspectArchive, restoreProject } from "../../../../modules/projectBackup/restoreProject";
import type { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";
import { gitCommitsResponseSchema } from "../../backups/dto";
import { inspectResponseSchema, newProjectSchema, restoreResponseSchema } from "./dto";
import { noIdleTimeout } from "./route";

/** a repository typed in; the username and token are used for this request only, never stored */
const repoSchema = z.object({
	url: gitUrlSchema,
	branch: gitBranchSchema,
	path: gitPathSchema.default(""),
	username: z.string().trim().max(500).optional(),
	token: z.string().trim().max(2000).optional().describe("empty for a public repository"),
});
const shaSchema = repoSchema.extend({
	sha: z
		.string()
		.regex(/^[0-9a-f]{40}$/)
		.describe("a commit the listing returned"),
});
const restoreSchema = shaSchema.extend(newProjectSchema.shape);

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
			400: {
				description: "The repository, the token or the backup is refused; the message says why",
			},
		},
	});

const json = <T extends z.ZodType>(schema: T) => validator("json", schema, zodErrorCallbackParser);
const remoteOf = (b: z.infer<typeof repoSchema>): GitRemote => ({
	url: b.url,
	branch: b.branch,
	username: b.username || undefined,
	token: b.token || undefined,
});

/**
 * A new project from a backup in any git repository (#1152), public or with a
 * token: list the branch's commits, inspect one, restore it. POST throughout,
 * so a token never sits in a URL. A system admin, as every restore that
 * creates a project.
 */
export function registerGitRestore(app: HonoServer) {
	app.post(
		"/restore/git/commits",
		doc(
			"list-git-restore-commits",
			"Lists a repository branch's newest commits",
			gitCommitsResponseSchema,
		),
		requireSystemAdmin,
		json(repoSchema),
		async (c) => {
			const remote = remoteOf(c.req.valid("json"));
			const commits = await listCommits(remote);
			if (!commits.length)
				throw new BadRequestError(
					`There is no branch ${remote.branch} in that repository, or it has no commits.`,
				);
			return c.json({ commits });
		},
	);
	app.post(
		"/restore/git/inspect",
		doc(
			"inspect-git-restore",
			"Reads the backup in a commit and returns what it holds; creates nothing",
			inspectResponseSchema,
		),
		requireSystemAdmin,
		json(shaSchema),
		async (c) => {
			const body = c.req.valid("json");
			return c.json(await inspectArchive(await openCommit(remoteOf(body), body.path, body.sha)));
		},
	);
	app.post(
		"/restore/git",
		doc(
			"restore-project-from-git",
			"Creates a project from the backup in a commit",
			restoreResponseSchema,
		),
		requireSystemAdmin,
		json(restoreSchema),
		async (c) => {
			noIdleTimeout(c);
			const { url, branch, path, username, token, sha, ...fields } = c.req.valid("json");
			const source = await openCommit(remoteOf({ url, branch, path, username, token }), path, sha);
			const { projectId, warnings } = await restoreProject(source, fields);
			return c.json({ id: projectId, warnings });
		},
	);
}

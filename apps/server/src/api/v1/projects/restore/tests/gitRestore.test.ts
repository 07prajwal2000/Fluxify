// A new project from a git repository typed in (#1152), against a real
// Postgres, NATS and Gitea: a public repo restores anonymously; a private one
// is refused without a token, in plain words, and restores with a read-only
// one; the token is never stored; a missing branch, folder or commit is
// refused with nothing created.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createStack, type Stack, short } from "../../../../../modules/deployments/tests/blockHarness";
import { GIT_USER, startGitea } from "../../../../../modules/projectBackup/tests/gitea";

let stack: Stack;
let gitea: Awaited<ReturnType<typeof startGitea>>;
let app: Hono<any>;

beforeAll(async () => {
	gitea = await startGitea("fluxify-restore-git-test");
	stack = await createStack("gitrestore");
	app = new Hono<any>();
	const { errorHandler } = await import("../../../../../middlewares/errorHandler");
	const { runWithAuditContext } = await import("../../../../../modules/audit/context");
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: ctx.req.header("X-Admin") === "yes" });
		ctx.set("acl", [{ projectId: ctx.req.header("X-Project"), role: "creator" }]);
		const actorId = ctx.req.header("X-User")!;
		await runWithAuditContext({ actor: { actorId, actorEmail: `${actorId}@example.com` }, source: "portal" }, next);
	});
	// the source project commits through #1150's routes; the restore is #1152's
	(await import("../../../backups/register")).default.registerHandler(app);
	(await import("../git")).registerGitRestore(app.basePath("/projects") as any);
}, 300_000);

afterAll(async () => {
	await stack?.stop();
	await gitea?.stop();
});

type Who = { user: string; project: string };

async function call(who: Who, method: string, path: string, body?: unknown, admin = true) {
	const res = await app.request(`http://localhost${path}`, {
		method,
		headers: {
			"X-User": who.user,
			"X-Project": who.project,
			"X-Admin": admin ? "yes" : "no",
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** a project with a route, committed once to a new repository; returns the repo's URL */
async function committed(isPrivate: boolean) {
	const { as } = await stack.setup();
	const who = { user: as.user, project: as.project };
	await stack.createRoute(as, true);
	const url = await gitea.repo(`src-${short()}`, isPrivate);
	const saved = await call(who, "PUT", `/${who.project}/backups/git`, {
		url,
		branch: "main",
		path: "shop",
		username: GIT_USER,
		email: "restore@example.com",
		token: gitea.token,
		encryptSecrets: true,
	});
	expect(saved.status).toBe(200);
	const started = await call(who, "POST", `/${who.project}/backups/git/commit`, { message: "for restore" });
	expect(started.status).toBe(200);
	for (let n = 0; n < 300; n++) {
		const [row] = await stack.sql`SELECT status, destination_key FROM project_backups WHERE id = ${started.body.id}`;
		if (row.status === "succeeded") return { who, url, sha: row.destination_key as string };
		expect(row.status).toBe("running");
		await Bun.sleep(100);
	}
	throw new Error("the commit never finished");
}

const routesOf = async (projectId: string) =>
	(await stack.sql`SELECT count(*)::int AS n FROM routes WHERE project_id = ${projectId}`)[0].n as number;
const projectCount = async () => (await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n as number;
/** every row of the tables a restore writes to, as text */
async function everything() {
	const rows = await stack.sql`
		SELECT row_to_json(t)::text AS r FROM project_settings t
		UNION ALL SELECT row_to_json(t)::text FROM project_backups t
		UNION ALL SELECT row_to_json(t)::text FROM projects t
		UNION ALL SELECT row_to_json(t)::text FROM integrations t
		UNION ALL SELECT row_to_json(t)::text FROM app_config t
		UNION ALL SELECT row_to_json(t)::text FROM audit_events t`;
	return rows.map((r: { r: string }) => r.r).join("\n");
}

describe("restore from a repository URL", () => {
	it("restores a public repository anonymously", async () => {
		const { who, url, sha } = await committed(false);
		const repo = { url, branch: "main", path: "shop" };

		const commits = await call(who, "POST", "/projects/restore/git/commits", repo);
		expect(commits.status).toBe(200);
		expect(commits.body.commits[0]).toMatchObject({ sha, message: "for restore" });

		const inspected = await call(who, "POST", "/projects/restore/git/inspect", { ...repo, sha });
		expect(inspected.status).toBe(200);
		expect(inspected.body.mode).toBe("backup");

		const restored = await call(who, "POST", "/projects/restore/git", { ...repo, sha, name: `pub ${short()}` });
		expect(restored.status).toBe(200);
		expect(await routesOf(restored.body.id)).toBe(1);
		const [git] = await stack.sql`SELECT count(*)::int AS n FROM project_settings
			WHERE project_id = ${restored.body.id} AND key LIKE 'settings.backup.git.%'`;
		expect(git.n).toBe(0);
	});

	it("refuses a private repository without a token, then restores it with a read-only one it never stores", async () => {
		const { who, url, sha } = await committed(true);
		const repo = { url, branch: "main", path: "shop" };

		const anonymous = await call(who, "POST", "/projects/restore/git/commits", repo);
		expect(anonymous.status).toBe(400);
		expect(anonymous.body.message).toContain("add a token");

		const bad = await call(who, "POST", "/projects/restore/git/commits", { ...repo, token: "not-a-token" });
		expect(bad.status).toBe(400);
		expect(bad.body.message).toContain("refused the username or token");

		// a token alone, no username, as GitHub and Gitea accept
		const withToken = { ...repo, token: gitea.readToken };
		expect((await call(who, "POST", "/projects/restore/git/commits", withToken)).status).toBe(200);
		const restored = await call(who, "POST", "/projects/restore/git", { ...withToken, sha, name: `priv ${short()}` });
		expect(restored.status).toBe(200);
		expect(await routesOf(restored.body.id)).toBe(1);
		expect(await everything()).not.toContain(gitea.readToken);
	});

	it("says what is wrong with a missing branch, folder or commit, and needs a system admin", async () => {
		const { who, url, sha } = await committed(false);
		const before = await projectCount();
		const repo = { url, branch: "main", path: "shop" };

		const branch = await call(who, "POST", "/projects/restore/git/commits", { ...repo, branch: "nope" });
		expect(branch.status).toBe(400);
		expect(branch.body.message).toContain("no branch nope");

		const folder = await call(who, "POST", "/projects/restore/git/inspect", { ...repo, path: "elsewhere", sha });
		expect(folder.status).toBe(400);
		expect(folder.body.message).toContain("holds no Fluxify backup in the folder elsewhere");

		const missing = await call(who, "POST", "/projects/restore/git/inspect", { ...repo, sha: "0".repeat(40) });
		expect(missing.status).toBe(404);

		const gone = await call(who, "POST", "/projects/restore/git/commits", { ...repo, url: `${gitea.url}/${GIT_USER}/none.git` });
		expect(gone.status).toBe(400);
		expect(gone.body.message).toContain("There is no repository");

		const notAdmin = await call(who, "POST", "/projects/restore/git", { ...repo, sha, name: `x ${short()}` }, false);
		expect(notAdmin.status).toBe(403);
		expect(await projectCount()).toBe(before);
	});
});

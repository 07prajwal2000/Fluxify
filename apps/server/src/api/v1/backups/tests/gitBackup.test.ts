// Commits to a git repository (#1150) against a real Postgres, NATS and Gitea
// (git smart HTTP, a token over plain http://): the first commit to an empty
// repo, a commit on top of a shallow fetch, a branch that moved meanwhile, the
// sealed sections and their unchanged blobs, read back, and a restore as a new
// project with encryption on and off, and on an instance with another key.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import * as gitRepo from "../../../../modules/projectBackup/gitRepo";
import { createStack, type Stack, short } from "../../../../modules/deployments/tests/blockHarness";
import { GIT_USER, startGitea } from "../../../../modules/projectBackup/tests/gitea";

let stack: Stack;
let gitea: Awaited<ReturnType<typeof startGitea>>;
let app: Hono<any>;

beforeAll(async () => {
	gitea = await startGitea("fluxify-backup-git-test");
	stack = await createStack("gitbackups");
	// the harness's users are never system admins; restore needs one
	app = new Hono<any>();
	const { errorHandler } = await import("../../../../middlewares/errorHandler");
	const { runWithAuditContext } = await import("../../../../modules/audit/context");
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: ctx.req.header("X-Admin") === "yes" });
		ctx.set("acl", [{ projectId: ctx.req.header("X-Project"), role: "creator" }]);
		const actorId = ctx.req.header("X-User")!;
		await runWithAuditContext({ actor: { actorId, actorEmail: `${actorId}@example.com` }, source: "portal" }, next);
	});
	(await import("../register")).default.registerHandler(app);
}, 300_000);

afterAll(async () => {
	await stack?.stop();
	await gitea?.stop();
});

type Who = { user: string; project: string };

async function call(who: Who, method: string, path: string, body?: unknown, admin = true) {
	const res = await app.request(`http://localhost/${who.project}/backups${path}`, {
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

const SECRET = "app-config-secret-value";

/** a project with a route, a secret app config value, and the git credentials as app config */
async function project(token = gitea.token) {
	const { as } = await stack.setup();
	await stack.createRoute(as, true);
	await stack.sql`INSERT INTO app_config (key_name, value, project_id, encoding_type) VALUES
		('GIT_USER', ${GIT_USER}, ${as.project}, 'plaintext'), ('GIT_TOKEN', ${token}, ${as.project}, 'plaintext'),
		('API_KEY', ${SECRET}, ${as.project}, 'plaintext')`;
	return { user: as.user, project: as.project };
}

async function setUp(who: Who, url: string, over: object = {}) {
	const saved = await call(who, "PUT", "/git", {
		url,
		branch: "main",
		path: "backups/shop",
		username: "cfg:GIT_USER",
		token: "cfg:GIT_TOKEN",
		encryptSecrets: true,
		...over,
	});
	expect(saved.status).toBe(200);
}

/** "Commit to git", waited for; returns the finished row */
async function commit(who: Who, message: string) {
	const started = await call(who, "POST", "/git/commit", { message });
	expect(started.status).toBe(200);
	for (let n = 0; n < 300; n++) {
		const [row] = await stack.sql`SELECT * FROM project_backups WHERE id = ${started.body.id}`;
		if (row.status !== "running") return row;
		await Bun.sleep(100);
	}
	throw new Error("the commit never finished");
}

const remote = (url: string) => ({ url, branch: "main", username: GIT_USER, token: gitea.token });

/** the backup folder's files at the branch tip, read straight from the repository */
async function tipFiles(url: string, path = "backups/shop") {
	const repo = await gitRepo.fetchBranch(remote(url));
	return { tip: repo.tip!, files: await gitRepo.readFolder(repo, repo.tip!, path), repo };
}

/** a commit by someone else: `file` at the repository's root */
async function pushOther(url: string, file: string) {
	const repo = await gitRepo.fetchBranch(remote(url));
	const blob = await gitRepo.writeBlob(repo, new TextEncoder().encode(file));
	const blobs = new Map([[file, blob]]);
	const author = { name: "Someone", email: "someone@example.com" };
	const oid = await gitRepo.commitFolder(repo, { path: "other", blobs, message: file, author });
	await gitRepo.pushCommit(repo, remote(url), oid);
}

const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : "");
const routesOf = async (projectId: string) =>
	(await stack.sql`SELECT count(*)::int AS n FROM routes WHERE project_id = ${projectId}`)[0].n as number;
const configOf = async (projectId: string) =>
	(await stack.sql`SELECT value FROM app_config WHERE project_id = ${projectId} AND key_name = 'API_KEY'`)[0]
		?.value as string | undefined;
const gitSettingsOf = async (projectId: string) =>
	(await stack.sql`SELECT key FROM project_settings WHERE project_id = ${projectId} AND key LIKE 'settings.backup.git.%'`)
		.length;

async function restore(who: Who, sha: string, admin = true) {
	return call(who, "POST", "/git/restore", { sha, name: `restored ${short()}` }, admin);
}

describe("commit to git, encrypted", () => {
	it("commits to an empty repo, then on top, sealing only the secret sections", async () => {
		const who = await project();
		const url = await gitea.repo(`enc-${short()}`);
		await setUp(who, url);

		const first = await commit(who, "first backup");
		expect(first.status).toBe("succeeded");
		expect(first.type).toBe("git");
		expect(first.label).toBe("first backup");
		expect(first.destination_key).toMatch(/^[0-9a-f]{40}$/);

		const a = await tipFiles(url);
		expect(a.tip).toBe(first.destination_key);
		expect(a.files.has("manifest.json")).toBe(true);
		expect(a.files.has("sections/routes.json")).toBe(true);
		expect(a.files.has("sections/appConfig.json.enc")).toBe(true);
		expect(a.files.has("sections/integrations.json.enc")).toBe(true);
		expect(a.files.has("sections/appConfig.json")).toBe(false);
		for (const bytes of a.files.values()) expect(text(bytes)).not.toContain(SECRET);

		// someone else commits elsewhere in the repo; ours goes on top and keeps theirs
		await pushOther(url, "notes.txt");
		const second = await commit(who, "second backup");
		expect(second.status).toBe("succeeded");
		const b = await tipFiles(url);
		expect(text((await gitRepo.readFolder(b.repo, b.tip, "other")).get("notes.txt"))).toBe("notes.txt");
		// an unchanged secret section keeps its blob, so it doesn't show in the diff
		const sealed = "backups/shop/sections/appConfig.json.enc";
		expect((await gitRepo.readTipFile(b.repo, sealed))!.oid).toBe((await gitRepo.readTipFile(a.repo, sealed))!.oid);

		const listed = await call(who, "GET", "/git/commits");
		expect(listed.status).toBe(200);
		expect(listed.body.commits.map((c: { message: string }) => c.message)).toEqual([
			"second backup",
			"notes.txt",
			"first backup",
		]);
	});

	it("retries once when the branch moved between the fetch and the push", async () => {
		const who = await project();
		const url = await gitea.repo(`moved-${short()}`);
		await setUp(who, url);
		await commit(who, "base");
		const real = gitRepo.fetchBranch;
		const fetch = spyOn(gitRepo, "fetchBranch").mockImplementationOnce(async (r, depth) => {
			const repo = await real(r, depth);
			await pushOther(url, "racing.txt");
			return repo;
		});
		const row = await commit(who, "after the race");
		fetch.mockRestore();
		expect(row.status).toBe("succeeded");
		const listed = await call(who, "GET", "/git/commits");
		expect(listed.body.commits.map((c: { message: string }) => c.message)).toEqual([
			"after the race",
			"racing.txt",
			"base",
		]);
	});

	it("restores a commit as a new project, with its secrets and without the git settings", async () => {
		const who = await project();
		const url = await gitea.repo(`restore-${short()}`);
		await setUp(who, url);
		const { destination_key: sha } = await commit(who, "to restore");

		const inspected = await call(who, "POST", "/git/inspect", { sha });
		expect(inspected.status).toBe(200);
		expect(inspected.body).toMatchObject({ mode: "backup" });
		expect(inspected.body.warnings.map((w: { message: string }) => w.message).join()).toContain(
			"Commits to git are not set up",
		);

		const restored = await restore(who, sha);
		expect(restored.status).toBe(200);
		expect(await routesOf(restored.body.id)).toBe(1);
		expect(await configOf(restored.body.id)).toBe(SECRET);
		expect(await gitSettingsOf(restored.body.id)).toBe(0);
		expect(await gitSettingsOf(who.project)).toBe(6);
	});

	it("on an instance with another key, restores everything but the sealed sections", async () => {
		const who = await project();
		const url = await gitea.repo(`otherkey-${short()}`);
		await setUp(who, url);
		const { destination_key: sha } = await commit(who, "sealed");
		// imported late: the env is read once, after the harness sets the key
		const { EncryptionService } = await import("../../../../lib/encryption");
		const key = spyOn(EncryptionService as any, "getMasterKey").mockReturnValue(Buffer.alloc(32, 3));
		try {
			const inspected = await call(who, "POST", "/git/inspect", { sha });
			expect(inspected.status).toBe(200);
			const skipped = inspected.body.warnings.filter((w: { message: string }) =>
				w.message.includes("different MASTER_ENCRYPTION_KEY"),
			);
			expect(skipped.map((w: { section: string }) => w.section).sort()).toEqual(["appConfig", "integrations"]);
			const restored = await restore(who, sha);
			expect(restored.status).toBe(200);
			expect(await routesOf(restored.body.id)).toBe(1);
			expect(await configOf(restored.body.id)).toBeUndefined();
		} finally {
			key.mockRestore();
		}
	});
});

describe("commit to git, not encrypted", () => {
	it("keeps the secret sections as plain JSON and restores them", async () => {
		const who = await project();
		const url = await gitea.repo(`plain-${short()}`);
		await setUp(who, url, { encryptSecrets: false, path: "" });
		const { destination_key: sha, status } = await commit(who, "plain");
		expect(status).toBe("succeeded");
		const { files } = await tipFiles(url, "");
		expect(files.has("sections/appConfig.json.enc")).toBe(false);
		expect(text(files.get("sections/appConfig.json"))).toContain(SECRET);

		const restored = await restore(who, sha);
		expect(restored.status).toBe(200);
		expect(await configOf(restored.body.id)).toBe(SECRET);
	});
});

describe("refusals", () => {
	it("a wrong token fails the run with a message, and nothing is restored without a system admin", async () => {
		const url = await gitea.repo(`refuse-${short()}`);
		const bad = await project("not-a-token");
		await setUp(bad, url);
		const row = await commit(bad, "never lands");
		expect(row.status).toBe("failed");
		expect(row.error).toContain("refused the username or token");
		expect((await call(bad, "GET", "/git/commits")).status).toBe(400);

		const who = await project();
		await setUp(who, url);
		const { destination_key: sha } = await commit(who, "lands");
		expect((await restore(who, sha, false)).status).toBe(403);
		expect((await restore(who, "0".repeat(40))).status).toBe(404);
	});

	it("refuses settings with credentials in the URL, a literal token, or a bad folder", async () => {
		const who = await project();
		const base = {
			url: "http://example.com/x.git",
			branch: "main",
			path: "",
			username: "cfg:GIT_USER",
			token: "cfg:GIT_TOKEN",
			encryptSecrets: true,
		};
		for (const over of [
			{ url: "http://user:pass@example.com/x.git" },
			{ url: "ftp://example.com/x.git" },
			{ path: "../up" },
			{ path: ".git/hooks" },
			{ branch: "a..b" },
		])
			expect((await call(who, "PUT", "/git", { ...base, ...over })).status).toBe(400);
	});
});

describe("a username and token typed in", () => {
	it("are stored encrypted, never sent back, and never committed", async () => {
		// the app config holds no copy of the token, so any trace of it would be a leak
		const who = await project("not-the-token");
		const url = await gitea.repo(`typed-${short()}`);
		await setUp(who, url, { username: GIT_USER, token: gitea.token, encryptSecrets: false });

		const shown = await call(who, "GET", "/git");
		expect(shown.body.settings).toMatchObject({ username: GIT_USER, token: "********" });
		const [stored] = await stack.sql`SELECT value FROM project_settings
			WHERE project_id = ${who.project} AND key = 'settings.backup.git.token'`;
		expect(stored.value.startsWith("enc:")).toBe(true);
		expect(stored.value).not.toContain(gitea.token);

		const first = await commit(who, "typed");
		expect(first.status).toBe("succeeded");
		// saving again with the mask keeps the stored token
		await setUp(who, url, { username: GIT_USER, token: "********", encryptSecrets: false });
		expect((await commit(who, "typed again")).status).toBe("succeeded");

		const { files } = await tipFiles(url, "");
		expect(files.size).toBeGreaterThan(3);
		for (const [path, bytes] of files) {
			expect({ path, leaked: text(bytes).includes(gitea.token) }).toEqual({ path, leaked: false });
			expect(text(bytes)).not.toContain("settings.backup.git.token");
		}
	});
});

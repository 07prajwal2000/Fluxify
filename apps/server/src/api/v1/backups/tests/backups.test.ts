// Manual project backups (#1103) against a real Postgres and NATS: start, run in
// the background, hold the archive in the Object Store, download it, expire it.
// The real backup modules run on an empty project, so the archive is what a user
// would download. Failures are real too: a folder plugin that changed after it
// was approved, and a module that blows up unexpectedly.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStack, type Stack, short } from "../../../../modules/deployments/tests/blockHarness";

let stack: Stack;
let svc: typeof import("../service");
let audit: typeof import("../../../../modules/audit");
let archives: typeof import("../../../../modules/projectBackup/archives");
let engine: typeof import("../../../../modules/projectBackup/archive");
let modules: typeof import("../../../../modules/projectBackup/modules");
let restore: typeof import("../../../../modules/projectBackup/restore");
let objects: typeof import("../../../../db/natsObjects");
const folder = mkdtempSync(join(tmpdir(), "fx-backup-plugins-"));

beforeAll(async () => {
	stack = await createStack("backups");
	(await import("../register")).default.registerHandler(stack.app);
	svc = await import("../service");
	audit = await import("../../../../modules/audit");
	archives = await import("../../../../modules/projectBackup/archives");
	engine = await import("../../../../modules/projectBackup/archive");
	modules = await import("../../../../modules/projectBackup/modules");
	restore = await import("../../../../modules/projectBackup/restore");
	objects = await import("../../../../db/natsObjects");
}, 240_000);

afterAll(async () => {
	rmSync(folder, { recursive: true, force: true });
	await stack?.stop();
});
afterEach(() => {
	delete process.env.FLUXIFY_PLUGINS_DIR;
});

const ALL = () => modules.BACKUP_MODULES.map((m) => m.name);
const body = (extra: object = {}) => ({ mode: "backup", sections: ALL(), ...extra });

/** starts one over HTTP and waits for it to end, as the portal does by polling the list */
async function run(as: Awaited<ReturnType<Stack["setup"]>>["as"], extra: object = {}) {
	const started = await stack.call(as, "POST", `/${as.project}/backups`, body(extra));
	expect(started.status).toBe(200);
	for (let i = 0; i < 300; i++) {
		const listed = await stack.call(as, "GET", `/${as.project}/backups`);
		const row = listed.body.backups.find((b: { id: string }) => b.id === started.body.id);
		if (row.status !== "running") return row;
		await Bun.sleep(100);
	}
	throw new Error("the backup never finished");
}

const fetchArchive = async (as: { user: string; project: string; role?: string }, id: string) =>
	stack.app.request(`http://localhost/${as.project}/backups/${id}/download`, {
		headers: { "X-User": as.user, "X-Project": as.project, "X-Role": as.role ?? "creator" },
	});

describe("manual backup", () => {
	it("starts, succeeds, and downloads an archive that reads back", async () => {
		const { project, as, userId } = await stack.setup();
		const record = spyOn(audit.audit, "record");
		const row = await run(as, { readme: "# Hello\nrestore on a fresh instance" });

		expect(row).toMatchObject({
			type: "manual",
			mode: "backup",
			status: "succeeded",
			error: null,
			downloadable: true,
		});
		expect(row.sizeBytes).toBeGreaterThan(0);
		expect(row.release).toBeString();
		expect(row.sections).toEqual(ALL());
		expect(Object.keys(row.formatVersions).sort()).toEqual(ALL().sort());
		expect(row.createdBy.email).toBe(`${userId}@example.com`);
		expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());

		const res = await fetchArchive(as, row.id);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/gzip");
		expect(res.headers.get("content-disposition")).toMatch(
			new RegExp(`filename="${project}-backup-\\d{8}-\\d{4}\\.tar\\.gz"`),
		);
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes.length).toBe(row.sizeBytes);

		const manifest = await engine.readManifest(bytes);
		expect(manifest).toMatchObject({ mode: "backup", readme: "# Hello\nrestore on a fresh instance" });
		expect(manifest.sections).toEqual(row.formatVersions);
		// the whole archive passes every restore check, key and hash included
		await restore.readBackup(bytes, modules.BACKUP_MODULES);

		const actions = record.mock.calls.map(([call]) => `${call.action}:${call.resourceType}`);
		expect(actions).toEqual(["create:project_backup", "download:project_backup"]);
		// property names only: the README text is never an audit value
		expect(JSON.stringify(record.mock.calls)).not.toContain("restore on a fresh");
		record.mockRestore();
	});

	it("keeps only the sections asked for, and a template is plain", async () => {
		const { as } = await stack.setup();
		const row = await run(as, { mode: "template", sections: ["routes", "workflows"] });
		expect(row).toMatchObject({ mode: "template", sections: ["routes", "workflows"] });
		expect(Object.keys(row.formatVersions).sort()).toEqual(["routes", "workflows"]);
		const bytes = new Uint8Array(await (await fetchArchive(as, row.id)).arrayBuffer());
		const entries = [...(await new Bun.Archive(bytes).files()).keys()];
		expect(entries).toContain("sections/routes.json");
		expect(entries).not.toContain("payload.enc");
	});

	it("remembers the README for the next backup", async () => {
		const { project, as } = await stack.setup();
		await run(as, { sections: ["routes"], readme: "first" });
		const stored = async () =>
			(await stack.sql`SELECT value FROM project_settings WHERE project_id = ${project} AND key = 'settings.backup.readme'`)[0]?.value;
		expect(await stored()).toBe("first");
		// not sending one leaves it alone; sending an empty one clears it
		await run(as, { sections: ["routes"] });
		expect(await stored()).toBe("first");
		await run(as, { sections: ["routes"], readme: "" });
		expect(await stored()).toBe("");
	});

	it("refuses an unknown section, a second run while one is going, and an oversize README", async () => {
		const { project, as } = await stack.setup();
		const bad = await stack.call(as, "POST", `/${project}/backups`, body({ sections: ["nope"] }));
		expect(bad.status).toBe(400);
		expect(bad.body.error ?? bad.body.message).toContain('There is no "nope" section');

		const big = await stack.call(
			as,
			"POST",
			`/${project}/backups`,
			body({ readme: "a".repeat(engine.MAX_README_BYTES + 1) }),
		);
		expect(big.status).toBe(400);

		await stack.sql`INSERT INTO project_backups (id, project_id, type, mode, sections, status)
			VALUES (${`b${short()}`}, ${project}, 'manual', 'backup', '[]'::jsonb, 'running')`;
		const second = await stack.call(as, "POST", `/${project}/backups`, body());
		expect(second.status).toBe(409);
		expect(JSON.stringify(second.body)).toContain("already running");
	});
});

describe("a failed backup", () => {
	/** every object a manual backup of this project left in the store */
	const held = async (project: string) => (await (await objects.backupObjects()).keys(`manual/${project}/`));

	it("names the folder plugin that changed, says what to do, and leaves no file", async () => {
		const { project, as } = await stack.setup();
		mkdirSync(join(folder, "echo"), { recursive: true });
		writeFileSync(join(folder, "echo", "index.js"), "export default 2");
		process.env.FLUXIFY_PLUGINS_DIR = folder;
		await stack.sql`INSERT INTO plugins (id, project_id, name, version, source, location, integrity, url, sdk_range, manifest)
			VALUES (${`p${short()}`}, ${project}, 'acme/echo', '1.0.0', 'fs', 'echo', 'sha256-approved-earlier',
				'https://example.com', '>=1', '{}'::jsonb)`;

		const row = await run(as);
		expect(row).toMatchObject({ status: "failed", downloadable: false, sizeBytes: null });
		expect(row.error).toContain('Plugin "acme/echo" 1.0.0');
		expect(row.error).toContain("changed since it was approved");
		expect(row.error).toContain("Approve the changed version again");
		expect(row.error).toContain("untick Plugins");
		expect(await held(project)).toEqual([]);

		const download = await fetchArchive(as, row.id);
		expect(download.status).toBe(409);

		// without plugins the same project backs up fine
		const without = await run(as, { sections: ALL().filter((n) => n !== "plugins") });
		expect(without.status).toBe("succeeded");
	});

	it("shows a generic message for an unexpected error, never its detail", async () => {
		const { project, as } = await stack.setup();
		const routes = modules.BACKUP_MODULES.find((m) => m.name === "routes")!;
		const boom = spyOn(routes, "export").mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:5432"));
		const row = await run(as);
		boom.mockRestore();
		expect(row.status).toBe("failed");
		expect(row.error).toContain("failed unexpectedly");
		expect(row.error).not.toContain("10.1.2.3");
		expect(await held(project)).toEqual([]);
	});

	it("fails a run whose process died, and stops it blocking the next", async () => {
		const { project, as } = await stack.setup();
		await stack.sql`INSERT INTO project_backups (id, project_id, type, mode, sections, status, created_at)
			VALUES (${`b${short()}`}, ${project}, 'manual', 'backup', '[]'::jsonb, 'running', now() - interval '2 hours')`;
		// a stale row doesn't block a new run
		expect((await run(as, { sections: ["routes"] })).status).toBe("succeeded");
		const { interrupted } = await archives.expireBackups();
		expect(interrupted).toBeGreaterThanOrEqual(1);
		const rows = (await stack.call(as, "GET", `/${project}/backups`)).body.backups;
		expect(rows.some((r: { error: string | null }) => r.error?.includes("interrupted"))).toBe(true);
	});
});

describe("expiry", () => {
	it("deletes the archive after the retention but keeps the row as history", async () => {
		const { project, as } = await stack.setup();
		const row = await run(as, { sections: ["routes"] });
		const key = archives.archiveKey(project, row.id);
		expect(await (await objects.backupObjects()).get(key)).not.toBeNull();

		// younger than the retention: kept
		await archives.expireBackups();
		expect((await fetchArchive(as, row.id)).status).toBe(200);

		await stack.sql`UPDATE project_backups SET finished_at = now() - interval '8 days' WHERE id = ${row.id}`;
		const { expired } = await archives.expireBackups();
		expect(expired).toBeGreaterThanOrEqual(1);
		expect(await (await objects.backupObjects()).get(key)).toBeNull();

		const after = (await stack.call(as, "GET", `/${project}/backups`)).body;
		const kept = after.backups.find((b: { id: string }) => b.id === row.id);
		expect(kept).toMatchObject({ status: "succeeded", downloadable: false, expiresAt: null });
		expect(after.retentionDays).toBe(archives.ARCHIVE_RETENTION_DAYS);
		const gone = await fetchArchive(as, row.id);
		expect(gone.status).toBe(404);
		expect(JSON.stringify(await gone.json())).toContain("expired");
	});
});

describe("access control", () => {
	it("needs creator on the project, for every endpoint", async () => {
		const { project, as } = await stack.setup();
		const row = await run(as, { sections: ["routes"] });
		const viewer = { ...as, role: "viewer" };
		const other = await stack.setup();
		// a creator of another project, asking for this one
		const outsider = { user: other.as.user, project: other.project };

		for (const who of [viewer, outsider]) {
			const headers = {
				"X-User": who.user,
				"X-Project": who.project,
				"X-Role": (who as { role?: string }).role ?? "creator",
				"content-type": "application/json",
			};
			const get = (path: string) => stack.app.request(`http://localhost/${project}/backups${path}`, { headers });
			expect((await get("")).status).toBe(403);
			expect((await get("/sections")).status).toBe(403);
			expect((await get(`/${row.id}/download`)).status).toBe(403);
			const post = await stack.app.request(`http://localhost/${project}/backups`, {
				method: "POST",
				headers,
				body: JSON.stringify(body()),
			});
			expect(post.status).toBe(403);
		}
		// refused before anything was recorded
		const rows = await stack.sql`SELECT count(*)::int AS n FROM project_backups WHERE project_id = ${project}`;
		expect(rows[0].n).toBe(1);
	});

	it("never serves another project's backup through your own project", async () => {
		const a = await stack.setup();
		const b = await stack.setup();
		const row = await run(a.as, { sections: ["routes"] });
		const res = await stack.call(b.as, "GET", `/${b.project}/backups/${row.id}/download`);
		expect(res.status).toBe(404);
		const listed = (await stack.call(b.as, "GET", `/${b.project}/backups`)).body.backups;
		expect(listed).toEqual([]);
	});

	it("lists the registered sections with what each depends on", async () => {
		const { project, as } = await stack.setup();
		const { body: res } = await stack.call(as, "GET", `/${project}/backups/sections`);
		expect(res.sections.map((s: { name: string }) => s.name)).toEqual(ALL());
		expect(res.sections.find((s: { name: string }) => s.name === "routes").dependsOn).toContain("integrations");
		expect(svc.sections().sections).toEqual(res.sections);
	});
});

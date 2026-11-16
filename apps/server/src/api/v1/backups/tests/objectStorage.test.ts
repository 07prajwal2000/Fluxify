// Backups to object storage (#1106) against a real Postgres, NATS and MinIO:
// the settings endpoints, a scheduled run, "Back up now", retention, failures
// (a missing bucket, a changed folder plugin), a Community downgrade, and a
// restored project that must not write into the source's prefix.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStack, type Stack, short } from "../../../../modules/deployments/tests/blockHarness";
import { startMinio } from "./minio";

let stack: Stack;
let minio: Awaited<ReturnType<typeof startMinio>>;
let bucket: Awaited<ReturnType<typeof startMinio>>["bucket"];
let tick: typeof import("../../../../modules/projectBackup/storageRun");
let edition: typeof import("../../../../lib/edition");
let audit: typeof import("../../../../modules/audit");
let restoreProject: typeof import("../../../../modules/projectBackup/restoreProject").restoreProject;
const folder = mkdtempSync(join(tmpdir(), "fx-s3backup-plugins-"));

beforeAll(async () => {
	minio = await startMinio("fluxify-backup-s3-test");
	bucket = minio.bucket;

	stack = await createStack("s3backups");
	(await import("../register")).default.registerHandler(stack.app);
	tick = await import("../../../../modules/projectBackup/storageRun");
	edition = await import("../../../../lib/edition");
	audit = await import("../../../../modules/audit");
	restoreProject = (await import("../../../../modules/projectBackup/restoreProject")).restoreProject;
	await license("NON_COMMERCIAL", "non_commercial");
}, 300_000);

/** publishes a key and waits for this process's watch to see it */
async function license(key: string | undefined, status: string) {
	await edition.publishLicenseKey(key);
	for (let i = 0; i < 100 && edition.currentEntitlement().status !== status; i++) await Bun.sleep(50);
	expect(edition.currentEntitlement().status).toBe(status);
}

afterAll(async () => {
	rmSync(folder, { recursive: true, force: true });
	delete process.env.FLUXIFY_PLUGINS_DIR;
	await stack?.stop();
	await minio?.stop();
});

const s3Config = (over: object = {}) => minio.s3Config(over);

type As = Awaited<ReturnType<Stack["setup"]>>["as"];

/** a project with an Object Storage integration pointing at MinIO, and its settings saved */
async function project(settings: object = {}, config: object = {}) {
	const { project: id, as } = await stack.setup();
	const integrationId = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO integrations (id, project_id, name, "group", variant, config)
		VALUES (${integrationId}, ${id}, ${`s3-${short()}`}, 'storage', 'S3 Compatible',
			${JSON.stringify(s3Config(config))}::text::jsonb)`;
	const prefix = `p-${short()}`;
	const saved = await stack.call(as, "PUT", `/${id}/backups/schedule`, {
		integrationId,
		prefix,
		interval: "daily",
		retention: 7,
		enabled: true,
		sections: ["routes", "workflows", "projectSettings"],
		...settings,
	});
	expect(saved.status).toBe(200);
	return { id, as, prefix, integrationId };
}

/** every key under `<prefix>/` */
async function keys(prefix: string) {
	const out: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list(`${prefix}/`, { cursor });
		out.push(...page.objects.map((o) => o.key));
		cursor = page.cursor;
	} while (cursor);
	return out.sort();
}

const rows = (id: string) =>
	stack.sql`SELECT * FROM project_backups WHERE project_id = ${id} ORDER BY created_at`;

/** "Back up now" over HTTP, waiting for the run to end */
async function backupNow(as: As) {
	const res = await stack.call(as, "POST", `/${as.project}/backups/object-storage`);
	expect(res.status).toBe(200);
	for (let i = 0; i < 300; i++) {
		const [row] = await stack.sql`SELECT * FROM project_backups WHERE id = ${res.body.id}`;
		if (row.status !== "running") return row;
		await Bun.sleep(100);
	}
	throw new Error("the backup never finished");
}

describe("scheduled backups", () => {
	it("uploads the archive and its summary, then does nothing on a second tick that day", async () => {
		const { id, as, prefix } = await project();
		const now = new Date();
		const first = await tick.runScheduledBackups(now);
		expect(first.started).toBeGreaterThanOrEqual(1);

		const [row] = await rows(id);
		expect(row).toMatchObject({ type: "object_storage", mode: "backup", status: "succeeded", created_by: null });
		const listed = await keys(prefix);
		expect(listed).toHaveLength(2);
		const archiveKey = row.destination_key as string;
		expect(archiveKey).toMatch(new RegExp(`^${prefix}/\\d{8}T\\d{6}Z-${row.id}\\.tar\\.gz$`));
		// ".meta.json" sorts before ".tar.gz"
		expect(listed).toEqual([archiveKey.replace(".tar.gz", ".meta.json"), archiveKey]);

		const archive = new Uint8Array(await new Response(await bucket.get(archiveKey)).arrayBuffer());
		expect(archive.length).toBe(Number(row.size_bytes));
		const meta = JSON.parse(await new Response(await bucket.get(listed[0]!)).text());
		expect(meta).toMatchObject({
			kind: "fluxify.project.backup-meta",
			backupId: row.id,
			mode: "backup",
			sizeBytes: archive.length,
			source: { projectId: id, slug: id },
			hasReadme: false,
		});
		expect(Object.keys(meta.sections).sort()).toEqual(["projectSettings", "routes", "workflows"]);
		expect(meta.release).toBeString();

		// the same day: not due, nothing new
		await tick.runScheduledBackups(new Date(now.getTime() + 60_000));
		expect(await rows(id)).toHaveLength(1);
		// the next day: due again
		await tick.runScheduledBackups(new Date(now.getTime() + 24 * 60 * 60_000));
		expect(await rows(id)).toHaveLength(2);

		// the settings page shows the last run
		const read = await stack.call(as, "GET", `/${id}/backups/schedule`);
		expect(read.body.lastRun).toMatchObject({ type: "object_storage", status: "succeeded" });
		expect(read.body.schedule).toMatchObject({ prefix, enabled: true, interval: "daily" });
	});

	it("skips a disabled project", async () => {
		const { id } = await project({ enabled: false });
		await tick.runScheduledBackups();
		expect(await rows(id)).toHaveLength(0);
	});
});

describe("Back up now", () => {
	it("uploads at once, enabled or not, and is audited", async () => {
		const { id, as, prefix } = await project({ enabled: false });
		const record = spyOn(audit.audit, "record");
		const row = await backupNow(as);
		expect(row).toMatchObject({ type: "object_storage", status: "succeeded", created_by: as.user });
		expect(await keys(prefix)).toHaveLength(2);
		const actions = record.mock.calls.map(([c]) => `${c.action}:${c.resourceType}`);
		expect(actions).toContain("create:project_backup");
		record.mockRestore();
		expect(id).toBeString();
	});

	it("refuses before an integration is saved", async () => {
		const { project: id, as } = await stack.setup();
		const res = await stack.call(as, "POST", `/${id}/backups/object-storage`);
		expect(res.status).toBe(400);
	});
});

describe("retention", () => {
	it("deletes the oldest pairs beyond N, and only under this project's prefix", async () => {
		const { as, prefix } = await project({ retention: 2 });
		// a neighbour whose prefix starts with this one's
		const neighbour = await project({ prefix: `${prefix}b`, retention: 1 });
		await backupNow(neighbour.as);

		const made = [];
		for (let i = 0; i < 3; i++) made.push((await backupNow(as)).destination_key as string);
		// several in one second share a stamp; the uuidv7 ids after it still sort by time
		const left = await keys(prefix);
		expect(left).toHaveLength(4);
		expect(left).not.toContain(made[0]);
		expect(left.filter((k) => k.endsWith(".tar.gz")).sort()).toEqual(made.slice(1).sort());
		expect(await keys(`${prefix}b`)).toHaveLength(2);
	});
});

describe("a failed backup", () => {
	it("logs a bucket that doesn't exist and leaves no summary", async () => {
		const missing = `nope-${short().toLowerCase()}`;
		const { id, as, prefix } = await project({}, { bucket: missing });
		const row = await backupNow(as);
		expect(row.status).toBe("failed");
		expect(row.error).toContain(`Bucket "${missing}" does not exist`);
		expect(await keys(prefix)).toEqual([]);
		expect((await rows(id)).length).toBe(1);
	});

	it("names the changed folder plugin when a scheduled run fails", async () => {
		const { id, prefix } = await project({ sections: ["plugins"] });
		mkdirSync(join(folder, "echo"), { recursive: true });
		writeFileSync(join(folder, "echo", "index.js"), "export default 2");
		process.env.FLUXIFY_PLUGINS_DIR = folder;
		await stack.sql`INSERT INTO plugins (id, project_id, name, version, source, location, integrity, url, sdk_range, manifest)
			VALUES (${`p${short()}`}, ${id}, 'acme/echo', '1.0.0', 'fs', 'echo', 'sha256-approved-earlier',
				'https://example.com', '>=1', '{}'::jsonb)`;
		await tick.runScheduledBackups();
		delete process.env.FLUXIFY_PLUGINS_DIR;

		const [row] = await rows(id);
		expect(row.status).toBe("failed");
		expect(row.error).toContain('Plugin "acme/echo" 1.0.0');
		expect(row.error).toContain("changed since it was approved");
		expect(await keys(prefix)).toEqual([]);
	});
});

describe("edition", () => {
	it("on Community: keeps the settings and history, runs nothing, refuses changes", async () => {
		const { id, as, prefix, integrationId } = await project();
		await backupNow(as);
		await license(undefined, "community");
		try {
			const next = new Date(Date.now() + 2 * 24 * 60 * 60_000);
			expect((await tick.runScheduledBackups(next)).started).toBe(0);
			expect(await rows(id)).toHaveLength(1);

			const read = await stack.call(as, "GET", `/${id}/backups/schedule`);
			expect(read.status).toBe(200);
			expect(read.body.schedule).toMatchObject({ prefix, integrationId, enabled: true });
			expect((await stack.call(as, "GET", `/${id}/backups`)).body.backups).toHaveLength(1);

			const save = await stack.call(as, "PUT", `/${id}/backups/schedule`, {
				...read.body.schedule,
				enabled: false,
			});
			expect(save.status).toBe(403);
			expect((await stack.call(as, "POST", `/${id}/backups/object-storage`)).status).toBe(403);
		} finally {
			await license("NON_COMMERCIAL", "non_commercial");
		}
	});
});

describe("settings", () => {
	it("refuses a prefix with a leading slash, and an integration that isn't Object Storage", async () => {
		const { id, as, integrationId } = await project();
		const base = { integrationId, prefix: "ok", interval: "weekly", retention: 3, enabled: true, sections: ["routes"] };
		expect((await stack.call(as, "PUT", `/${id}/backups/schedule`, { ...base, prefix: "/abs" })).status).toBe(400);
		const kv = Bun.randomUUIDv7();
		await stack.sql`INSERT INTO integrations (id, project_id, name, "group", variant, config)
			VALUES (${kv}, ${id}, ${`kv-${short()}`}, 'kv', 'Redis', '{}'::jsonb)`;
		expect((await stack.call(as, "PUT", `/${id}/backups/schedule`, { ...base, integrationId: kv })).status).toBe(400);
		// the generic settings write can't change them behind the license and prefix checks
		const upsert = (await import("../../projects/settings/keys/upsert/service")).default;
		await expect(upsert(id, { key: "settings.backup.storage.prefix", value: "elsewhere" })).rejects.toThrow(
			"Project Settings > Backup",
		);
	});
});

describe("a restored project", () => {
	it("comes up with the schedule off, no prefix, and a warning", async () => {
		const { as, prefix, integrationId } = await project({
			sections: ["integrations", "appConfig", "projectSettings"],
		});
		const row = await backupNow(as);
		expect(row.status).toBe("succeeded");
		const bytes = new Uint8Array(await new Response(await bucket.get(row.destination_key)).arrayBuffer());

		const { runWithAuditContext } = await import("../../../../modules/audit/context");
		const actor = { actorId: as.user, actorEmail: `${as.user}@example.com` };
		const { projectId, warnings } = await runWithAuditContext({ actor, source: "portal" }, () =>
			restoreProject(bytes, { name: `copy ${short()}`, slug: `copy-${short().toLowerCase()}` }),
		);
		expect(warnings.map((w: { message: string }) => w.message)).toContain(
			"Scheduled backups are off in the restored project; choose a prefix and turn them on.",
		);
		const settings = Object.fromEntries(
			(await stack.sql`SELECT key, value FROM project_settings WHERE project_id = ${projectId}`).map(
				(r: { key: string; value: string }) => [r.key, r.value],
			),
		);
		expect(settings["settings.backup.storage.enabled"]).toBe("false");
		expect(settings["settings.backup.storage.prefix"]).toBe("");
		// the integration came along (by name), so only the prefix and the switch are left to choose
		expect(settings["settings.backup.storage.integrationId"]).not.toBe(integrationId);
		expect(settings["settings.backup.storage.integrationId"]).toBeTruthy();

		// the tick backs up the source and leaves the copy alone: nothing of the copy's reaches the prefix
		await tick.runScheduledBackups(new Date(Date.now() + 2 * 24 * 60 * 60_000));
		const copies = await stack.sql`SELECT count(*)::int AS n FROM project_backups WHERE project_id = ${projectId}`;
		expect(copies[0].n).toBe(0);
		const meta = (await keys(prefix)).filter((k) => k.endsWith(".meta.json"));
		for (const key of meta)
			expect(JSON.parse(await new Response(await bucket.get(key)).text()).source.projectId).toBe(as.project);
	});
});

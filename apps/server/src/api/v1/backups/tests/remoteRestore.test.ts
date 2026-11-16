// Backups read back from object storage (#1107) against a real Postgres, NATS
// and MinIO: a fresh project finds another project's prefix, lists and
// restores from it; incomplete and malformed entries are hidden; bad keys,
// oversized archives and a taken subdomain are refused with nothing created;
// a project rolls back to its own older backup in a new project.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { S3Storage } from "@fluxify/adapters/storage/s3";
import { Hono } from "hono";
import { createStack, type Stack, short } from "../../../../modules/deployments/tests/blockHarness";
import { startMinio } from "./minio";

let stack: Stack;
let minio: Awaited<ReturnType<typeof startMinio>>;
let edition: typeof import("../../../../lib/edition");
let app: Hono<any>;

beforeAll(async () => {
	minio = await startMinio("fluxify-backup-remote-test");
	stack = await createStack("remotebackups");
	edition = await import("../../../../lib/edition");

	// the harness's users are never system admins; restore needs one
	app = new Hono<any>();
	const { errorHandler } = await import("../../../../middlewares/errorHandler");
	const { runWithAuditContext } = await import("../../../../modules/audit/context");
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: ctx.req.header("X-Admin") === "yes" });
		ctx.set("acl", [{ projectId: ctx.req.header("X-Project"), role: "creator" }]);
		// the server's auth middleware opens this for every request
		const actorId = ctx.req.header("X-User")!;
		await runWithAuditContext({ actor: { actorId, actorEmail: `${actorId}@example.com` }, source: "portal" }, next);
	});
	(await import("../register")).default.registerHandler(app);
	await license("NON_COMMERCIAL", "non_commercial");
}, 300_000);

afterAll(async () => {
	await stack?.stop();
	await minio?.stop();
});

async function license(key: string | undefined, status: string) {
	await edition.publishLicenseKey(key);
	for (let i = 0; i < 100 && edition.currentEntitlement().status !== status; i++) await Bun.sleep(50);
	expect(edition.currentEntitlement().status).toBe(status);
}

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

/** a project with an Object Storage integration on the shared bucket */
async function project() {
	const { as } = await stack.setup();
	const integrationId = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO integrations (id, project_id, name, "group", variant, config)
		VALUES (${integrationId}, ${as.project}, ${`s3-${short()}`}, 'storage', 'S3 Compatible',
			${JSON.stringify(minio.s3Config())}::text::jsonb)`;
	return { as, who: { user: as.user, project: as.project }, integrationId };
}

/** a project with a live route and a subdomain, backed up `times` times under its own prefix */
async function source(times = 1) {
	const p = await project();
	await stack.createRoute(p.as, true);
	const subdomain = `sd${short()}`.toLowerCase();
	await stack.sql`INSERT INTO project_settings (id, project_id, key, value)
		VALUES (${short()}, ${p.as.project}, 'settings.routing.subdomain', ${subdomain})`;
	const prefix = `src-${short()}`;
	const saved = await call(p.who, "PUT", "/schedule", {
		integrationId: p.integrationId,
		prefix,
		interval: "daily",
		retention: 10,
		enabled: false,
		sections: ["routes", "workflows", "projectSettings"],
	});
	expect(saved.status).toBe(200);
	for (let i = 0; i < times; i++) {
		const started = await call(p.who, "POST", "/object-storage");
		expect(started.status).toBe(200);
		for (let n = 0; n < 300; n++) {
			const [row] = await stack.sql`SELECT status FROM project_backups WHERE id = ${started.body.id}`;
			if (row.status !== "running") break;
			await Bun.sleep(100);
		}
	}
	return { ...p, prefix, subdomain };
}

const projectCount = async () => (await stack.sql`SELECT count(*)::int AS n FROM projects`)[0].n as number;
const routesOf = async (projectId: string) =>
	(await stack.sql`SELECT count(*)::int AS n FROM routes WHERE project_id = ${projectId}`)[0].n as number;
const subdomainOf = async (projectId: string) =>
	(
		await stack.sql`SELECT value FROM project_settings
			WHERE project_id = ${projectId} AND key = 'settings.routing.subdomain' AND value <> ''`
	)[0]?.value as string | undefined;
const put = (key: string, text: string) => minio.bucket.put(key, new TextEncoder().encode(text));

describe("disaster recovery", () => {
	it("a fresh project finds the source's prefix, lists its backups and restores one", async () => {
		const src = await source(2);
		const fresh = await project();
		const q = `integrationId=${fresh.integrationId}`;

		const prefixes = await call(fresh.who, "GET", `/remote/prefixes?${q}`);
		expect(prefixes.status).toBe(200);
		expect(prefixes.body.prefixes).toContain(src.prefix);

		const list = await call(fresh.who, "GET", `/remote?${q}&prefix=${src.prefix}`);
		expect(list.status).toBe(200);
		const backups = list.body.backups;
		expect(backups).toHaveLength(2);
		// newest first
		expect(backups[0].key > backups[1].key).toBe(true);
		expect(backups[0]).toMatchObject({
			mode: "backup",
			source: { projectId: src.as.project },
		});
		// not an asymmetric matcher inside toMatchObject: Bun writes the matcher over the value
		expect(backups[0].key).toMatch(new RegExp(`^${src.prefix}/\\d{8}T\\d{6}Z-.+\\.tar\\.gz$`));
		expect(Object.keys(backups[0].sections).sort()).toEqual(["projectSettings", "routes", "workflows"]);
		const head = await minio.bucket.head(backups[0].key);
		expect(backups[0].sizeBytes).toBe(head!.size);

		const body = { integrationId: fresh.integrationId, key: backups[0].key };
		const inspected = await call(fresh.who, "POST", "/remote/inspect", body);
		expect(inspected.status).toBe(200);
		expect(inspected.body).toMatchObject({ mode: "backup", encrypted: true });

		const before = await projectCount();
		const name = `restored ${short()}`;
		const restored = await call(fresh.who, "POST", "/remote/restore", { ...body, name });
		expect(restored.status).toBe(200);
		expect(await projectCount()).toBe(before + 1);
		const [row] = await stack.sql`SELECT name FROM projects WHERE id = ${restored.body.id}`;
		expect(row.name).toBe(name);
		expect(await routesOf(restored.body.id)).toBe(1);
		// the empty project is left as it was
		expect(await routesOf(fresh.as.project)).toBe(0);
	});

	it("hides an archive without a summary and skips summaries that don't parse", async () => {
		const src = await source(1);
		const stamp = "20200101T000000Z";
		await put(`${src.prefix}/${stamp}-incomplete.tar.gz`, "not really");
		await put(`${src.prefix}/${stamp}-garbage.tar.gz`, "x");
		await put(`${src.prefix}/${stamp}-garbage.meta.json`, "{ not json");
		await put(`${src.prefix}/${stamp}-wrongkind.tar.gz`, "x");
		await put(`${src.prefix}/${stamp}-wrongkind.meta.json`, JSON.stringify({ kind: "something-else" }));

		const list = await call(src.who, "GET", `/remote?integrationId=${src.integrationId}&prefix=${src.prefix}`);
		expect(list.status).toBe(200);
		expect(list.body.backups).toHaveLength(1);
		expect(list.body.backups[0].key).not.toContain(stamp);

		const incomplete = { integrationId: src.integrationId, key: `${src.prefix}/${stamp}-incomplete.tar.gz` };
		const refused = await call(src.who, "POST", "/remote/inspect", incomplete);
		expect(refused.status).toBe(400);
		expect(refused.body.message).toContain("incomplete");
	});
});

describe("refusals create nothing", () => {
	it("a wrong key, a key outside the layout, and a non-admin", async () => {
		const src = await source(1);
		const before = await projectCount();
		const restore = (key: string, admin = true) =>
			call(src.who, "POST", "/remote/restore", { integrationId: src.integrationId, key, name: `x ${short()}` }, admin);

		expect((await restore(`${src.prefix}/20200101T000000Z-missing.tar.gz`)).status).toBe(404);
		expect((await restore("../etc/20200101T000000Z-x.tar.gz")).status).toBe(400);
		expect((await restore(`${src.prefix}/backup.tar.gz`)).status).toBe(400);
		const [real] = (await call(src.who, "GET", `/remote?integrationId=${src.integrationId}&prefix=${src.prefix}`)).body
			.backups;
		expect((await restore(real.key, false)).status).toBe(403);
		expect(await projectCount()).toBe(before);
	});

	it("an archive over the cap, before downloading it", async () => {
		const src = await source(1);
		const [real] = (await call(src.who, "GET", `/remote?integrationId=${src.integrationId}&prefix=${src.prefix}`)).body
			.backups;
		const { MAX_REMOTE_ARCHIVE_BYTES } = await import("../../../../modules/projectBackup/remote");
		const realHead = S3Storage.prototype.head;
		const head = spyOn(S3Storage.prototype, "head").mockImplementation(async function (this: S3Storage, key) {
			const found = await realHead.call(this, key);
			return found && { ...found, size: MAX_REMOTE_ARCHIVE_BYTES + 1 };
		});
		const get = spyOn(S3Storage.prototype, "get");
		try {
			const res = await call(src.who, "POST", "/remote/inspect", { integrationId: src.integrationId, key: real.key });
			expect(res.status).toBe(400);
			expect(res.body.message).toContain("the largest that can be restored is 512 MB");
			expect(get).not.toHaveBeenCalled();
		} finally {
			head.mockRestore();
			get.mockRestore();
		}
	});

	it("a subdomain from the form that another project holds", async () => {
		const src = await source(1);
		const [real] = (await call(src.who, "GET", `/remote?integrationId=${src.integrationId}&prefix=${src.prefix}`)).body
			.backups;
		const before = await projectCount();
		const res = await call(src.who, "POST", "/remote/restore", {
			integrationId: src.integrationId,
			key: real.key,
			name: `taken ${short()}`,
			subdomain: src.subdomain,
		});
		expect(res.status).toBe(409);
		expect(res.body.message).toContain(`'${src.subdomain}' is already used by another project`);
		expect(await projectCount()).toBe(before);
	});

	it("listing on Community", async () => {
		const src = await project();
		await license(undefined, "community");
		try {
			const res = await call(src.who, "GET", `/remote/prefixes?integrationId=${src.integrationId}`);
			expect(res.status).toBe(403);
		} finally {
			await license("NON_COMMERCIAL", "non_commercial");
		}
	});
});

describe("rollback", () => {
	it("restores a project's own older backup into a new project; the original keeps its subdomain", async () => {
		const src = await source(2);
		const list = await call(src.who, "GET", `/remote?integrationId=${src.integrationId}&prefix=${src.prefix}`);
		const older = list.body.backups[1];
		const name = `${src.as.project.slice(0, 20)} (restored 2026-11-16)`;

		const res = await call(src.who, "POST", "/remote/restore", { integrationId: src.integrationId, key: older.key, name });
		expect(res.status).toBe(200);
		const messages = res.body.warnings.map((w: { message: string }) => w.message);
		expect(messages.some((m: string) => m.includes(`The subdomain "${src.subdomain}" is already used`))).toBe(true);

		expect(await subdomainOf(src.as.project)).toBe(src.subdomain);
		expect(await subdomainOf(res.body.id)).toBeUndefined();
		expect(await routesOf(src.as.project)).toBe(1);
		expect(await routesOf(res.body.id)).toBe(1);
		const [row] = await stack.sql`SELECT name FROM projects WHERE id = ${res.body.id}`;
		expect(row.name).toBe(name);
	});
});

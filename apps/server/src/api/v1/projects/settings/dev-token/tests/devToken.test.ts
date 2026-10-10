// The development access token (#734) against a real Postgres: what is stored,
// what each environment's config carries, and who may read or rotate it. A fake
// db cannot show that the secret stays out of the settings map and the
// production config, which is the whole point.
import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const PG = { image: "postgres:16-alpine", name: "fluxify-dev-token-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

type Published = { env: string; payload: any };
const published: Published[] = [];

const natsKv = await import("../../../../../../db/natsKv");
const redis = await import("../../../../../../db/redis");
const publisher = await import("../../../../../../modules/compiler/publisher");
const { EncryptionService } = await import("../../../../../../lib/encryption");
const { hashDevToken, verifyDevToken } = await import("../../../../../../modules/requestRouter/devToken");

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	const { migrateDB } = await import("../../../../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../../../../db", () => ({ db: drizzle({ client: sql }) }));

	// the config goes to a recorder instead of NATS, unsealed so it can be read
	spyOn(natsKv, "putArtifact").mockImplementation(async (_key, artifact: any, env) => {
		published.push({ env: env ?? "production", payload: JSON.parse(EncryptionService.decrypt(artifact.sealed)) });
	});
	spyOn(redis, "getCache").mockResolvedValue(null);
	spyOn(redis, "setCache").mockResolvedValue(undefined as never);
	spyOn(publisher, "requestProjectConfigPublish").mockResolvedValue(undefined as never);

	const registerDevToken = (await import("../route")).default;
	const registerGetAll = (await import("../../keys/get-all/route")).default;
	const { errorHandler } = await import("../../../../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	// the real `requireProjectAccess`, fed the role (and project) the test asks for
	app.use(async (ctx, next) => {
		ctx.set("user", { id: "u1", isSystemAdmin: false });
		ctx.set("acl", [
			{ projectId: ctx.req.header("X-Project") ?? "*", role: ctx.req.header("X-Role") ?? "creator" },
		]);
		await next();
	});
	registerDevToken(app);
	registerGetAll(app.basePath("/:id/settings/keys"));
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

async function newProject() {
	const id = `p${crypto.randomUUID().slice(0, 8)}`;
	await sql`INSERT INTO projects (id, name, slug) VALUES (${id}, ${id}, ${id})`;
	return id;
}

const call = async (id: string, role: string, method: "GET" | "POST" = "GET", extra: Record<string, string> = {}) => {
	const path = method === "GET" ? "" : "/rotate";
	const res = await app.request(`http://localhost/${id}/settings/dev-token${path}`, {
		method,
		headers: { "X-Role": role, ...extra },
	});
	return { status: res.status, body: (await res.json()) as any };
};

const TOKEN = /^fxd_[A-Za-z0-9_-]{43}$/;
const configOf = (env: string, from: number) => published.slice(from).findLast((p) => p.env === env)!.payload;

describe("access", () => {
	it("refuses a viewer on read and on rotate", async () => {
		const id = await newProject();
		expect((await call(id, "viewer")).status).toBe(403);
		expect((await call(id, "viewer", "POST")).status).toBe(403);
	});

	it("lets a creator read but not rotate", async () => {
		const id = await newProject();
		const read = await call(id, "creator");
		expect(read.status).toBe(200);
		expect(read.body.token).toMatch(TOKEN);
		expect((await call(id, "creator", "POST")).status).toBe(403);
		expect((await call(id, "creator")).body.token).toBe(read.body.token);
	});

	it("lets a project admin read and rotate", async () => {
		const id = await newProject();
		const before = (await call(id, "project_admin")).body.token;
		const rotated = await call(id, "project_admin", "POST");
		expect(rotated.status).toBe(200);
		expect(rotated.body.token).toMatch(TOKEN);
		expect(rotated.body.token).not.toBe(before);
		expect((await call(id, "project_admin")).body.token).toBe(rotated.body.token);
	});

	it("does not carry a role on another project over", async () => {
		const id = await newProject();
		expect((await call(id, "project_admin", "GET", { "X-Project": "other" })).status).toBe(403);
		expect((await call(id, "project_admin", "POST", { "X-Project": "other" })).status).toBe(403);
	});

	it("answers 404 for a project that does not exist", async () => {
		expect((await call("nope", "project_admin")).status).toBe(404);
		expect((await call("nope", "project_admin", "POST")).status).toBe(404);
	});
});

describe("creation", () => {
	it("makes a token with the project, sealed at rest", async () => {
		const create = (await import("../../../create/service")).default;
		const { id } = await create({ name: `Billing ${crypto.randomUUID().slice(0, 6)}` } as any);

		const rows = await sql`SELECT token FROM project_dev_tokens WHERE project_id = ${id}`;
		expect(rows.length).toBe(1);
		expect(rows[0].token).not.toContain("fxd_");
		expect(EncryptionService.decrypt(rows[0].token)).toMatch(TOKEN);
		expect(publisher.requestProjectConfigPublish).toHaveBeenCalledWith(id, "project created");
	});

	it("makes one on first read for a project that has none, and tells the dev workers", async () => {
		const id = await newProject();
		expect((await sql`SELECT 1 FROM project_dev_tokens WHERE project_id = ${id}`).length).toBe(0);

		const from = published.length;
		const { body } = await call(id, "creator");
		expect(body.token).toMatch(TOKEN);
		expect(configOf("development", from).devTokenHash).toBe(hashDevToken(body.token));
		// and it is the same one next time
		expect((await call(id, "creator")).body.token).toBe(body.token);
	});

	it("keeps one token when first reads race", async () => {
		const id = await newProject();
		const tokens = await Promise.all([1, 2, 3, 4].map(() => call(id, "creator")));
		expect(new Set(tokens.map((t) => t.body.token)).size).toBe(1);
		expect((await sql`SELECT 1 FROM project_dev_tokens WHERE project_id = ${id}`).length).toBe(1);
	});
});

describe("what leaves the admin", () => {
	it("ships only the hash, only in the development config", async () => {
		const id = await newProject();
		const { token } = (await call(id, "creator")).body;
		const [{ token: sealed }] = await sql`SELECT token FROM project_dev_tokens WHERE project_id = ${id}`;

		// a real settings row, loaded the way the admin's cache loads them
		await sql`INSERT INTO project_settings (id, project_id, key, value) VALUES (${crypto.randomUUID().slice(0, 20)}, ${id}, 'settings.ai.maxSteps', '12')`;
		const { getAllProjectSettings } = await import("../../../../../../lib/project-settings");
		const { hydrateProjectSettings } = await import("../../../../../../loaders/projectSettingsLoader");
		hydrateProjectSettings(id, (await getAllProjectSettings())[id]);

		const { buildProjectConfig } = await import("../../../../../../modules/compiler/projectConfig");
		const dev = await buildProjectConfig(id, "development");
		const prod = await buildProjectConfig(id, "production");

		expect(dev.devTokenHash).toBe(hashDevToken(token));
		expect("devTokenHash" in prod).toBe(false);
		for (const payload of [dev, prod]) {
			expect(payload.projectSettings).toEqual({ "settings.ai.maxSteps": "12" });
			const text = JSON.stringify(payload);
			expect(text).not.toContain(token);
			expect(text).not.toContain(sealed);
		}
	});

	it("keeps the token out of the settings list", async () => {
		const id = await newProject();
		const { token } = (await call(id, "creator")).body;
		const [{ token: sealed }] = await sql`SELECT token FROM project_dev_tokens WHERE project_id = ${id}`;

		const res = await app.request(`http://localhost/${id}/settings/keys`, { headers: { "X-Role": "creator" } });
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain(token);
		expect(text).not.toContain(sealed);
		expect(JSON.parse(text)).toEqual({});
	});
});

describe("rotate", () => {
	it("kills the old token on the dev worker and republishes without it", async () => {
		const id = await newProject();
		const oldToken = (await call(id, "project_admin")).body.token;

		const from = published.length;
		const newToken = (await call(id, "project_admin", "POST")).body.token;

		// both buckets were rewritten, so nothing stale is left in either
		expect(published.slice(from).map((p) => p.env).sort()).toEqual(["development", "production"]);
		const dev = configOf("development", from);
		const prod = configOf("production", from);
		expect(dev.devTokenHash).toBe(hashDevToken(newToken));
		expect(dev.devTokenHash).not.toBe(hashDevToken(oldToken));

		expect(verifyDevToken(dev, oldToken)).toBe(false);
		expect(verifyDevToken(dev, newToken)).toBe(true);
		expect(verifyDevToken(prod, newToken)).toBe(false);
		expect(verifyDevToken(prod, oldToken)).toBe(false);
		expect(verifyDevToken(dev, undefined)).toBe(false);
	});
});

// The plugin registry (#857) against a real Postgres and a real NATS: the
// migration applies, approval moves through its states, the bucket holds a
// plugin only where it may load, and a route that calls a plugin block
// compiles only once its plugin is approved. Mocks would only prove the calls;
// the bucket proves what a worker would find.
import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";
import { entry, manifest } from "./fixtures";

const PG = { image: "postgres:16-alpine", name: "fluxify-plugins-pg-test" };
const NATS = { image: "nats:2.14", name: "fluxify-plugins-nats-test" };
let pg: Docker.Container | undefined;
let nats: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const natsKv = await import("../../../db/natsKv");
const { pluginKey, routeKey } = await import("../../compiler/subjects");
const publisher = await import("../../compiler/publisher");
/** recompiles the registry asked for, by project */
const recompiles: string[] = [];
spyOn(publisher, "requestProjectCompile").mockImplementation(async (projectId) => {
	recompiles.push(projectId);
});

async function waitForPostgres(url: string) {
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			return;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
}

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await docker.getContainer(NATS.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	await pullImage(NATS.image);

	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	pg = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	await waitForPostgres(url);
	const { migrateDB } = await import("../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../db", () => ({ db: drizzle({ client: sql }) }));

	const broker = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: NATS.image,
			name: NATS.name,
			Cmd: ["-js"],
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "4222/tcp": {} },
		}),
	);
	nats = broker.container;
	for (let i = 0; ; i++) {
		try {
			await connectNats({ servers: `nats://127.0.0.1:${broker.port}` });
			await natsKv.getArtifact("probe", "production");
			break;
		} catch (error) {
			await closeNats().catch(() => {});
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}

	const routes = (await import("../../../api/v1/routes/register")).default;
	const plugins = (await import("../../../api/v1/plugins/register")).default;
	const { errorHandler } = await import("../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: false });
		ctx.set("acl", [
			{ projectId: ctx.req.header("X-Project"), role: ctx.req.header("X-Role") ?? "creator" },
		]);
		await next();
	});
	routes.registerHandler(app);
	plugins.registerHandler(app);
}, 240_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await closeNats().catch(() => {});
	await pg?.remove({ force: true }).catch(() => {});
	await nats?.remove({ force: true }).catch(() => {});
});

const short = () => crypto.randomUUID().slice(0, 8);
const service = () => import("../service");
type As = { user: string; project: string; role?: string };

async function call(as: As, method: string, path: string, body?: unknown) {
	const res = await app.request(`http://localhost${path}`, {
		method,
		headers: {
			"X-User": as.user,
			"X-Project": as.project,
			"X-Role": as.role ?? "creator",
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** a project with its own plugin `acme/<random>`, so tests never share state */
async function setup() {
	const project = Bun.randomUUIDv7();
	await sql`INSERT INTO projects (id, name, slug) VALUES (${project}, ${project}, ${project})`;
	const name = `acme/p${short()}`;
	const as: As = { user: `u${short()}`, project };
	const caller = { user: { id: as.user, isSystemAdmin: false } as any, acl: [{ projectId: project, role: "creator" }] as any };
	const path = (action = "") => `/plugins/${name}${action}?projectId=${project}`;
	return { project, name, type: `${name}/step`, as, caller, path };
}

const version = (name: string, integrity: string, blocks?: ReturnType<typeof entry>[]) => ({
	manifest: manifest(name, blocks ?? [entry(`${name}/step`)]),
	version: "2026.10.2001",
	source: "upload" as const,
	location: `plugins/${name}.tgz`,
	integrity,
});

const where = async (project: string, name: string) => ({
	development: await natsKv.getArtifact<any>(pluginKey(project, name), "development"),
	production: await natsKv.getArtifact<any>(pluginKey(project, name), "production"),
});

describe("plugin registry", () => {
	it("applies the migration: the plugins table is there", async () => {
		const [row] = await sql`SELECT to_regclass('public.plugins') AS t`;
		expect(row.t).toBe("plugins");
	});

	it("registers a new plugin as pending and publishes nothing", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		const { plugin, changed } = await registerPluginVersion(s.project, version(s.name, "sha-1"));
		expect(changed).toBe(true);
		expect(plugin).toMatchObject({ approval: "pending", devEnabled: true, prodEnabled: false });
		// nothing used it, nothing to rebuild
		expect(recompiles).not.toContain(s.project);
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });
	});

	it("refuses an invalid manifest, a bad version and a renamed upgrade", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		await expect(
			registerPluginVersion(s.project, { ...version(s.name, "x"), manifest: { name: s.name } }),
		).rejects.toThrow("Invalid fluxify.json");
		await expect(
			registerPluginVersion(s.project, { ...version(s.name, "x"), version: "latest" }),
		).rejects.toThrow("exact version");
		await expect(
			registerPluginVersion(s.project, { ...version("acme/other", "x"), expectedName: s.name }),
		).rejects.toThrow(`This is plugin acme/other, not ${s.name}`);
	});

	it("approval is creator-only and bound to the integrity reviewed", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		expect((await call({ ...s.as, role: "viewer" }, "POST", s.path("/approve"), {})).status).toBe(403);
		expect((await call(s.as, "POST", s.path("/approve"), { integrity: "sha-0" })).status).toBe(409);
		expect((await call(s.as, "GET", s.path())).body.approval).toBe("pending");
	});

	it("publishes an approved plugin only to the environments it is enabled in", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		const asked = [entry(`${s.name}/step`, { permissions: { integrations: ["kv"] } })];
		await registerPluginVersion(s.project, version(s.name, "sha-1", asked));

		const approved = await call(s.as, "POST", s.path("/approve"), { integrity: "sha-1" });
		expect(approved.status).toBe(200);
		expect(approved.body).toMatchObject({
			approval: "approved",
			approvedBy: s.as.user,
			permissions: { integrations: ["kv"], appconfig: false },
		});
		const { development, production } = await where(s.project, s.name);
		expect(production).toBeNull();
		expect(development).toMatchObject({
			name: s.name,
			version: "2026.10.2001",
			integrity: "sha-1",
			approval: "approved",
			permissions: { integrations: ["kv"], appconfig: false },
			blocks: {
				[s.type]: {
					entry: "dist/blocks/step.js",
					meta: { handles: { out: ["success", "failure"] }, invoke: ["sync"] },
				},
			},
		});

		// routing on plugin blocks is baked into emitted code: users recompile
		expect(recompiles.filter((p) => p === s.project)).toHaveLength(1);
		const moved = await call(s.as, "PUT", s.path("/environments"), { dev: false, prod: true });
		expect(recompiles.filter((p) => p === s.project)).toHaveLength(2);
		expect(moved.body).toMatchObject({ devEnabled: false, prodEnabled: true });
		const after = await where(s.project, s.name);
		expect(after.development).toBeNull();
		expect(after.production?.name).toBe(s.name);
	});

	it("same integrity changes nothing; new code goes back to pending and stops loading", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		await approvePlugin(s.project, s.name, s.caller);
		expect((await registerPluginVersion(s.project, version(s.name, "sha-1"))).changed).toBe(false);
		expect((await where(s.project, s.name)).development).not.toBeNull();

		// more permissions arrive as new code: new integrity, so pending again
		const more = [entry(`${s.name}/step`, { permissions: { appconfig: true } })];
		const { plugin } = await registerPluginVersion(s.project, version(s.name, "sha-2", more));
		expect(plugin).toMatchObject({ approval: "pending", approvedBy: null, integrity: "sha-2" });
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });

		const again = await approvePlugin(s.project, s.name, s.caller, "sha-2");
		expect(again.permissions).toEqual({ integrations: [], appconfig: true });
	});

	it("rejects, recording who decided, and unpublishes", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		await approvePlugin(s.project, s.name, s.caller);
		const rejected = await call(s.as, "POST", s.path("/reject"));
		expect(rejected.body).toMatchObject({ approval: "rejected", approvedBy: s.as.user });
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });
		const listed = await call(s.as, "GET", `/plugins/list?projectId=${s.project}`);
		expect(listed.body.map((p: any) => p.name)).toEqual([s.name]);
	});
});

describe("a route calling a plugin block", () => {
	const BLOCK = Bun.randomUUIDv7();
	const REPLY = Bun.randomUUIDv7();

	async function routeCalling(s: Awaited<ReturnType<typeof setup>>, handle = "success") {
		const created = await call(s.as, "POST", "/routes", {
			name: `r-${short()}`,
			path: `/${short()}`,
			method: "GET",
			projectId: s.project,
		});
		const id = created.body.id as string;
		const items = (await call(s.as, "GET", `/routes/${id}/canvas-items`)).body;
		const entryId = items.blocks.find((b: any) => b.type === "entrypoint").id;
		const blocks = [
			{ id: BLOCK, type: s.type, position: { x: 240, y: 0 }, data: {} },
			{ id: REPLY, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
		];
		const edges = [
			{ id: Bun.randomUUIDv7(), from: entryId, to: BLOCK, fromHandle: `${entryId}-source`, toHandle: `${BLOCK}-target` },
			{ id: Bun.randomUUIDv7(), from: BLOCK, to: REPLY, fromHandle: `${BLOCK}-${handle}`, toHandle: `${REPLY}-target` },
		];
		const saved = await call(s.as, "PUT", `/routes/${id}/save-canvas`, {
			actionsToPerform: {
				blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
				edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
			},
			changes: { blocks, edges },
		});
		return { id, saved };
	}

	const compile = async (id: string) => (await import("../../compiler/service")).compileRoute(id);
	const compileLog = async (id: string) =>
		(await sql`SELECT message FROM system_logs WHERE resource_id = ${id} AND type = 'compile'`)[0]
			?.message as string | undefined;

	it("saves only handles the manifest declares, and reads the specs back", async () => {
		const s = await setup();
		await (await service()).registerPluginVersion(s.project, version(s.name, "sha-1"));
		const bad = await routeCalling(s, "source");
		expect(bad.saved.status).toBe(400);
		expect(bad.saved.body.message).toContain(`has no "source" handle. Use success, failure`);

		const { id, saved } = await routeCalling(s);
		expect(saved.status).toBe(200);
		const items = (await call(s.as, "GET", `/routes/${id}/canvas-items`)).body;
		expect(items.handleSpecs[s.type].out).toEqual(["success", "failure"]);
	});

	it("fails clearly while pending, and compiles with pluginBlocks once approved", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		const { id } = await routeCalling(s);

		await compile(id);
		expect(await natsKv.getArtifact(routeKey(s.project, id), "development")).toBeNull();
		expect(await compileLog(id)).toBe(
			`Block ${s.type} cannot run: plugin ${s.name}@2026.10.2001 is waiting for a creator to approve it.`,
		);

		await approvePlugin(s.project, s.name, s.caller);
		await compile(id);
		const built = await natsKv.getArtifact<any>(routeKey(s.project, id), "development");
		expect(built.pluginBlocks).toEqual([s.type]);
		expect(built.source).toContain(`lib.invokeRouted(ctx, "${s.type}"`);
		expect(await compileLog(id)).toBe("Compiled");
	});
});

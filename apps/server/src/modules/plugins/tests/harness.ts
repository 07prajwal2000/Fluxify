// The plugin registry's container stack (#857, #860): a real Postgres and a
// real NATS, the routes and plugins HTTP API, and helpers that give each test
// a project and a plugin of its own. Importing it registers the hooks.
import { afterAll, beforeAll, mock, spyOn } from "bun:test";
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
export let sql: SQL;
let app: Hono<any>;

export const natsKv = await import("../../../db/natsKv");
export const { pluginKey, routeKey } = await import("../../compiler/subjects");
const publisher = await import("../../compiler/publisher");
/** recompiles the registry asked for, by project */
export const recompiles: string[] = [];
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

export const short = () => crypto.randomUUID().slice(0, 8);
export const service = () => import("../service");
export type As = { user: string; project: string; role?: string };

export async function call(as: As, method: string, path: string, body?: unknown) {
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
export async function setup() {
	const project = Bun.randomUUIDv7();
	await sql`INSERT INTO projects (id, name, slug) VALUES (${project}, ${project}, ${project})`;
	const name = `acme/p${short()}`;
	const as: As = { user: `u${short()}`, project };
	const caller = { user: { id: as.user, isSystemAdmin: false } as any, acl: [{ projectId: project, role: "creator" }] as any };
	const path = (action = "") => `/plugins/${name}${action}?projectId=${project}`;
	return { project, name, type: `${name}/step`, as, caller, path };
}

export const version = (name: string, integrity: string, blocks?: ReturnType<typeof entry>[]) => ({
	manifest: manifest(name, blocks ?? [entry(`${name}/step`)]),
	version: "2026.10.2001",
	source: "upload" as const,
	location: `plugins/${name}.tgz`,
	integrity,
});

export const where = async (project: string, name: string) => ({
	development: await natsKv.getArtifact<any>(pluginKey(project, name), "development"),
	production: await natsKv.getArtifact<any>(pluginKey(project, name), "production"),
});

/** a saved route: entrypoint → the plugin block → response on `handle`; `null` leaves the block terminal */
export async function routeCalling(s: Awaited<ReturnType<typeof setup>>, handle: string | null = "success", data = {}) {
	const created = await call(s.as, "POST", "/routes", {
		name: `r-${short()}`,
		path: `/${short()}`,
		method: "GET",
		projectId: s.project,
	});
	const id = created.body.id as string;
	const items = (await call(s.as, "GET", `/routes/${id}/canvas-items`)).body;
	const entryId = items.blocks.find((b: any) => b.type === "entrypoint").id;
	const BLOCK = Bun.randomUUIDv7();
	const REPLY = Bun.randomUUIDv7();
	const blocks = [
		{ id: BLOCK, type: s.type, position: { x: 240, y: 0 }, data },
		...(handle ? [{ id: REPLY, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } }] : []),
	];
	const edges = [
		{ id: Bun.randomUUIDv7(), from: entryId, to: BLOCK, fromHandle: `${entryId}-source`, toHandle: `${BLOCK}-target` },
		...(handle
			? [{ id: Bun.randomUUIDv7(), from: BLOCK, to: REPLY, fromHandle: `${BLOCK}-${handle}`, toHandle: `${REPLY}-target` }]
			: []),
	];
	const saved = await call(s.as, "PUT", `/routes/${id}/save-canvas`, {
		actionsToPerform: {
			blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
			edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
		},
		changes: { blocks, edges },
	});
	return { id, saved, block: BLOCK };
}


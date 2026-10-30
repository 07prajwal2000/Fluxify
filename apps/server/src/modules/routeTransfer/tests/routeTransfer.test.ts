// Route export and import (#1012, #1013) against a real Postgres: a route is exported
// over the HTTP API and imported back, so the canvas rules, the id remap and the
// test hooks all run for real. The change signal is recorded instead of sent.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-route-transfer-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const signals: { chan: string; id: unknown }[] = [];

const natsKv = await import("../../../db/natsKv");
const pubsub = await import("../../../db/pubsub");

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
	const { migrateDB } = await import("../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../db", () => ({ db: drizzle({ client: sql }) }));

	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		signals.push({ chan: String(chan), id });
	});
	spyOn(natsKv, "deleteArtifactEverywhere").mockImplementation(async () => {});

	const routes = (await import("../../../api/v1/routes/register")).default;
	const middlewares = (await import("../../../api/v1/middlewares/register")).default;
	const { errorHandler } = await import("../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		const project = ctx.req.header("X-Project");
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: false });
		ctx.set("acl", [{ projectId: project, role: ctx.req.header("X-Role") ?? "creator" }]);
		await next();
	});
	routes.registerHandler(app);
	middlewares.registerHandler(app);
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

beforeEach(() => {
	signals.length = 0;
});

const short = () => crypto.randomUUID().slice(0, 8);

async function newProject() {
	const id = Bun.randomUUIDv7();
	await sql`INSERT INTO projects (id, name, slug) VALUES (${id}, ${id}, ${id})`;
	return id;
}

async function newUser() {
	const id = `u${short()}`;
	await sql`INSERT INTO system_users (id, email, name) VALUES (${id}, ${`${id}@example.com`}, ${null})`;
	return { id, email: `${id}@example.com` };
}

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

async function setup() {
	const project = await newProject();
	const author = await newUser();
	return { project, author, as: { user: author.id, project } as As };
}

async function createRoute(as: As, path = `/${short()}`, method = "GET") {
	const res = await call(as, "POST", "/routes", {
		name: `r-${short()}`,
		path,
		method,
		projectId: as.project,
	});
	expect(res.status).toBe(200);
	return res.body.id as string;
}

/** the canvas of a route */
const canvas = async (as: As, kind: string, id: string) =>
	(await call(as, "GET", `/${kind}/${id}/canvas-items`)).body;

const exportRoute = async (as: As, id: string, includeTests = true) =>
	(await call(as, "GET", `/routes/${id}/export?includeTests=${includeTests}`)).body;

/** a suite on the route with a hook on its response block, written straight to the tables */
async function addSuite(routeId: string) {
	const suiteId = `s${short()}`;
	const [block] = await sql`SELECT id FROM blocks WHERE route_id = ${routeId} AND type = 'response'`;
	await sql`INSERT INTO test_suites (id, name, route_id, assertions, headers)
		VALUES (${suiteId}, 'returns 200', ${routeId},
		${JSON.stringify([{ target: "status", operator: "eq", expectedValue: "200" }])}::text::jsonb,
		${JSON.stringify({ "x-test": "1" })}::text::jsonb)`;
	await sql`INSERT INTO test_suite_block_hooks (id, suite_id, block_id, on_before)
		VALUES (${`h${short()}`}, ${suiteId}, ${block.id},
		${JSON.stringify({ kind: "script", value: "t.log('hi')" })}::text::jsonb)`;
	return block.id as string;
}

describe("route export and import", () => {
	it("round-trips a route with its tests onto a new route with new ids", async () => {
		const { as } = await setup();
		const source = await createRoute(as);
		const sourceResponseId = await addSuite(source);

		const bundle = await exportRoute(as, source);
		expect(bundle.kind).toBe("fluxify.route");
		expect(bundle.canvas.blocks.map((b: { type: string }) => b.type).sort()).toEqual(
			["entrypoint", "error_handler", "response"].sort(),
		);
		expect(bundle.suites).toHaveLength(1);

		bundle.route.name = `copy-${short()}`;
		bundle.route.path = `/${short()}`;
		const res = await call(as, "POST", "/routes/import", { projectId: as.project, bundle });
		expect(res.status).toBe(200);
		expect(res.body.warnings).toEqual([]);

		const imported = await canvas(as, "routes", res.body.id);
		expect(imported.blocks).toHaveLength(3);
		const sourceIds = new Set(bundle.canvas.blocks.map((b: { id: string }) => b.id));
		for (const block of imported.blocks) expect(sourceIds.has(block.id)).toBe(false);
		expect(imported.edges).toHaveLength(bundle.canvas.edges.length);

		// the suite came along, its hook now on the imported response block
		const importedResponse = imported.blocks.find((b: { type: string }) => b.type === "response");
		const hooks = await sql`SELECT h.block_id, s.name, s.headers FROM test_suite_block_hooks h
			JOIN test_suites s ON s.id = h.suite_id WHERE s.route_id = ${res.body.id}`;
		expect(hooks).toHaveLength(1);
		expect(hooks[0].block_id).toBe(importedResponse.id);
		expect(hooks[0].block_id).not.toBe(sourceResponseId);
		expect(hooks[0].name).toBe("returns 200");
		expect(hooks[0].headers).toEqual({ "x-test": "1" });

		// imported off in production, on in development
		const [row] = await sql`SELECT active, dev_active FROM routes WHERE id = ${res.body.id}`;
		expect(row.active).toBe(false);
		expect(row.dev_active).toBe(true);
	});

	it("leaves the tests out when asked to", async () => {
		const { as } = await setup();
		const source = await createRoute(as);
		await addSuite(source);
		expect((await exportRoute(as, source, false)).suites).toBeUndefined();
	});

	it("drops a middleware the project does not have and says so", async () => {
		const { as } = await setup();
		const bundle = await exportRoute(as, await createRoute(as));
		bundle.route = { ...bundle.route, name: `copy-${short()}`, path: `/${short()}` };
		bundle.middlewares.before = ["missing-mw"];
		const res = await call(as, "POST", "/routes/import", { projectId: as.project, bundle });
		expect(res.status).toBe(200);
		expect(res.body.warnings[0]).toContain('"missing-mw"');
	});

	it("carries the SSE broker by name, and drops one the project does not have", async () => {
		const { as } = await setup();
		const addIntegration = async (project: string, name: string, variant: string) => {
			const id = Bun.randomUUIDv7();
			await sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
				VALUES (${id}, ${name}, ${variant === "NATS" ? "queue" : "kv"}, ${variant}, ${"{}"}::text::jsonb, ${project})`;
			return id;
		};
		const name = `broker-${short()}`;
		const broker = await addIntegration(as.project, name, "Redis");
		const source = await createRoute(as);
		const patch = (id: string, sseBrokerId: string | null) =>
			call(as, "PATCH", `/routes/partial/${id}`, { sseBrokerId });
		// another project's integration, or a variant that cannot carry SSE, is refused
		const foreign = await addIntegration(await newProject(), `f-${short()}`, "NATS");
		expect((await patch(source, foreign)).status).toBe(400);
		expect((await patch(source, await addIntegration(as.project, `m-${short()}`, "Memcached"))).status).toBe(400);
		expect((await patch(source, broker)).status).toBe(200);
		expect((await call(as, "GET", `/routes/${source}`)).body.sseBrokerId).toBe(broker);

		const bundle = await exportRoute(as, source, false);
		expect(bundle.route.sseBroker).toBe(name);

		const target = { ...as, project: await newProject() };
		const targetBroker = await addIntegration(target.project, name, "NATS");
		const imported = await call(target, "POST", "/routes/import", { projectId: target.project, bundle });
		expect(imported.status).toBe(200);
		expect((await call(target, "GET", `/routes/${imported.body.id}`)).body.sseBrokerId).toBe(targetBroker);

		const elsewhere = { ...as, project: await newProject() };
		const dropped = await call(elsewhere, "POST", "/routes/import", { projectId: elsewhere.project, bundle });
		expect(dropped.status).toBe(200);
		expect(dropped.body.warnings.join(" ")).toContain(`"${name}"`);
		expect((await call(elsewhere, "GET", `/routes/${dropped.body.id}`)).body.sseBrokerId).toBeNull();

		// null clears it
		expect((await patch(source, null)).status).toBe(200);
		expect((await call(as, "GET", `/routes/${source}`)).body.sseBrokerId).toBeNull();
	});

	it("says what an import would clash with before it is imported", async () => {
		const { as } = await setup();
		const source = await createRoute(as);
		const { route } = await exportRoute(as, source);
		const check = (body: object) =>
			call(as, "POST", "/routes/import/check", { projectId: as.project, ...route, ...body });

		expect((await check({})).body).toEqual({ nameTaken: true, pathTaken: true });
		expect((await check({ name: "fresh" })).body).toEqual({ nameTaken: false, pathTaken: true });
		expect((await check({ path: "/fresh" })).body).toEqual({ nameTaken: true, pathTaken: false });
		expect((await check({ name: "fresh", method: "POST" })).body).toEqual({
			nameTaken: false,
			pathTaken: false,
		});

		// another project has none of it
		const other = await setup();
		const away = await call(other.as, "POST", "/routes/import/check", {
			projectId: other.project,
			...route,
		});
		expect(away.body).toEqual({ nameTaken: false, pathTaken: false });
	});

	it("refuses a clashing route with a 409 and creates nothing", async () => {
		const { as } = await setup();
		const bundle = await exportRoute(as, await createRoute(as));
		const before = await sql`SELECT count(*)::int AS n FROM routes WHERE project_id = ${as.project}`;
		const res = await call(as, "POST", "/routes/import", { projectId: as.project, bundle });
		expect(res.status).toBe(409);
		const after = await sql`SELECT count(*)::int AS n FROM routes WHERE project_id = ${as.project}`;
		expect(after[0].n).toBe(before[0].n);
	});

	it("imports into another project even when its path is taken in the first one", async () => {
		const source = await setup();
		const target = await setup();
		const bundle = await exportRoute(source.as, await createRoute(source.as, "/employees/active"));

		// same name and path as the original, in a different project: no clash
		const res = await call(target.as, "POST", "/routes/import", {
			projectId: target.project,
			bundle,
		});
		expect(res.status).toBe(200);
		const [row] = await sql`SELECT project_id, path FROM routes WHERE id = ${res.body.id}`;
		expect(row.project_id).toBe(target.project);
		expect(row.path).toBe("/employees/active");
	});

	it("refuses a newer bundle version and a foreign file", async () => {
		const { as } = await setup();
		const bundle = await exportRoute(as, await createRoute(as));
		const newer = await call(as, "POST", "/routes/import", {
			projectId: as.project,
			bundle: { ...bundle, version: 99 },
		});
		expect(newer.status).toBe(400);
		const foreign = await call(as, "POST", "/routes/import", {
			projectId: as.project,
			bundle: { kind: "fluxify.canvas" },
		});
		expect(foreign.status).toBe(400);
	});

	it("will not export a route of a project the caller cannot see", async () => {
		const mine = await setup();
		const other = await setup();
		const route = await createRoute(other.as);
		const res = await call(mine.as, "GET", `/routes/${route}/export`);
		expect(res.status).toBe(403);
	});
});

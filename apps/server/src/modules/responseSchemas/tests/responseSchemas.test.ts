// Route response schemas against a real Postgres, through the HTTP API: the unique
// row per status code, the revision bump, and commit / checkout of the schemas.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-response-schemas-pg-test" };
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


const put = (as: As, id: string, status: number | string, body: unknown) =>
	call(as, "PUT", `/routes/${id}/response-schemas/${status}`, body);
const listSchemas = async (as: As, id: string) =>
	(await call(as, "GET", `/routes/${id}/response-schemas`)).body as {
		statusCode: number;
		schema: any;
	}[];
const revision = async (as: As, id: string) =>
	(await call(as, "GET", `/routes/${id}/canvas-revision`)).body.canvasRevision as number;
const commit = (as: As, id: string, title: string) =>
	call(as, "POST", `/routes/${id}/versions`, { title });
const checkout = (as: As, id: string, versionId: string) =>
	call(as, "POST", `/routes/${id}/versions/${versionId}/checkout`, { title: "keep mine" });

const SAMPLE = { id: 1, name: "a", tags: ["x"] };
const codes = (rows: { statusCode: number }[]) => rows.map((r) => r.statusCode);

describe("save, list, delete", () => {
	it("infers from a sample, lists by status code, and replaces on a second save", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const saved = await put(as, id, 200, { sample: SAMPLE });
		expect(saved.status).toBe(200);
		expect(saved.body.schema.properties.map((p: any) => [p.key, p.dataType])).toEqual([
			["id", "int"],
			["name", "str"],
			["tags", "arr"],
		]);
		await put(as, id, 404, { schema: { dataType: "object", properties: [] } });
		expect(codes(await listSchemas(as, id))).toEqual([200, 404]);

		await put(as, id, 200, { sample: { only: true } });
		const rows = await listSchemas(as, id);
		expect(codes(rows)).toEqual([200, 404]);
		expect(rows[0]!.schema.properties.map((p: any) => p.key)).toEqual(["only"]);
	});

	it("rejects bad input", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		expect((await put(as, id, 200, {})).status).toBe(400);
		expect((await put(as, id, 200, { sample: 1, schema: { dataType: "str" } })).status).toBe(400);
		expect((await put(as, id, 200, { schema: { dataType: "nope" } })).status).toBe(400);
		expect((await put(as, id, 99, { sample: 1 })).status).toBe(400);
		expect((await put(as, id, 600, { sample: 1 })).status).toBe(400);
		expect((await put(as, id, "abc", { sample: 1 })).status).toBe(400);
		expect((await put(as, Bun.randomUUIDv7(), 200, { sample: 1 })).status).toBe(404);
		expect(await listSchemas(as, id)).toEqual([]);
	});

	it("a JSON null sample is a body, not a missing field", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		expect((await put(as, id, 200, { sample: null })).status).toBe(200);
	});

	it("deletes one status code, then 404s", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await put(as, id, 200, { sample: SAMPLE });
		await put(as, id, 500, { sample: SAMPLE });
		expect((await call(as, "DELETE", `/routes/${id}/response-schemas/200`)).status).toBe(204);
		expect(codes(await listSchemas(as, id))).toEqual([500]);
		expect((await call(as, "DELETE", `/routes/${id}/response-schemas/200`)).status).toBe(404);
	});

	it("a viewer reads but cannot write; another project sees nothing", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		await put(as, id, 200, { sample: SAMPLE });
		const viewer = { ...as, role: "viewer" };
		expect((await listSchemas(viewer, id)).length).toBe(1);
		expect((await put(viewer, id, 201, { sample: SAMPLE })).status).toBe(403);
		expect((await call(viewer, "DELETE", `/routes/${id}/response-schemas/200`)).status).toBe(403);
		const stranger = { ...as, project: await newProject() };
		expect((await call(stranger, "GET", `/routes/${id}/response-schemas`)).status).toBe(403);
		expect(project).not.toBe(stranger.project);
	});

	it("deleting the route removes its schemas", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await put(as, id, 200, { sample: SAMPLE });
		expect((await call(as, "DELETE", `/routes/${id}`)).status).toBe(204);
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM route_response_schemas WHERE route_id = ${id}`;
		expect(n).toBe(0);
	});
});

describe("versioning", () => {
	it("an edit is uncommitted work: it moves the revision and lets a commit through", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await put(as, id, 200, { sample: SAMPLE });
		expect((await commit(as, id, "v1")).status).toBe(200);
		expect((await commit(as, id, "again")).status).toBe(409);

		const before = await revision(as, id);
		await put(as, id, 200, { sample: { other: 1 } });
		expect(await revision(as, id)).toBe(before + 1);
		expect((await commit(as, id, "v2")).status).toBe(200);

		await call(as, "DELETE", `/routes/${id}/response-schemas/200`);
		expect((await commit(as, id, "v3")).status).toBe(200);
	});

	it("a commit keeps the schemas; checkout puts them back over the working copy", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await put(as, id, 200, { sample: SAMPLE });
		await put(as, id, 404, { sample: { error: "x" } });
		const v1 = (await commit(as, id, "v1")).body;

		const detail = (await call(as, "GET", `/routes/${id}/versions/${v1.id}`)).body;
		expect(detail.snapshot.settings.responseSchemas.map((r: any) => r.statusCode).sort()).toEqual([
			200, 404,
		]);

		await call(as, "DELETE", `/routes/${id}/response-schemas/404`);
		await put(as, id, 200, { sample: { changed: true } });
		await put(as, id, 500, { sample: { boom: 1 } });
		expect((await checkout(as, id, v1.id)).status).toBe(200);

		const rows = await listSchemas(as, id);
		expect(codes(rows)).toEqual([200, 404]);
		expect(rows[0]!.schema.properties.map((p: any) => p.key)).toEqual(["id", "name", "tags"]);
	});

	it("checkout of a version committed before schemas existed leaves the working copy's alone", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = (await commit(as, id, "old")).body;
		await sql`UPDATE canvas_versions SET snapshot = snapshot #- '{settings,responseSchemas}' WHERE id = ${v1.id}`;
		await put(as, id, 200, { sample: SAMPLE });
		expect((await checkout(as, id, v1.id)).status).toBe(200);
		expect(codes(await listSchemas(as, id))).toEqual([200]);
	});
});

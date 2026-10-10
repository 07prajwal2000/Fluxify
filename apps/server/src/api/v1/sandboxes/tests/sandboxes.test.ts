// Sandboxes (#735) against a real Postgres: who may see one, what a delete takes
// with it, and which bucket the compiler writes. The artifact store and the
// change signal are recorded instead of sent; the signal compiles right away,
// as the compile consumer would.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-sandboxes-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

type Write = { op: "put" | "delete"; key: string; env: string; value?: any };
const writes: Write[] = [];
const fired: { input: any; env: string }[] = [];
let devWorker = true;

const natsKv = await import("../../../../db/natsKv");
const pubsub = await import("../../../../db/pubsub");
const status = await import("../../../../modules/orchestrator/status");
const triggers = await import("../../../../modules/triggers/publisher");

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
	const { migrateDB } = await import("../../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../../db", () => ({ db: drizzle({ client: sql }) }));

	const { compileSandbox } = await import("../../../../modules/compiler/sandbox");
	spyOn(natsKv, "putArtifact").mockImplementation(async (key, value, env) => {
		writes.push({ op: "put", key, env: env ?? "production", value });
	});
	spyOn(natsKv, "deleteArtifact").mockImplementation(async (key, env) => {
		writes.push({ op: "delete", key, env: env ?? "production" });
	});
	spyOn(natsKv, "putArtifactEverywhere").mockImplementation(async (key, value) => {
		writes.push({ op: "put", key, env: "production", value });
	});
	// the compile consumer's job, done in line
	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		if (chan === pubsub.CHAN_ON_SANDBOX_CHANGE) await compileSandbox(String(id));
	});
	spyOn(status, "devWorkerOnline").mockImplementation(async () => devWorker);
	spyOn(triggers, "fireInternalTrigger").mockImplementation(async (input, env) => {
		fired.push({ input, env: env ?? "production" });
		return { id: "job-1" };
	});

	const sandboxes = (await import("../register")).default;
	const { errorHandler } = await import("../../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		const admin = ctx.req.header("X-Admin") === "1";
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: admin });
		ctx.set("acl", [
			admin
				? { projectId: "*", role: "system_admin" }
				: { projectId: ctx.req.header("X-Project"), role: ctx.req.header("X-Role") ?? "creator" },
		]);
		await next();
	});
	sandboxes.registerHandler(app);
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

beforeEach(() => {
	writes.length = 0;
	fired.length = 0;
	devWorker = true;
});

const short = () => crypto.randomUUID().slice(0, 8);

async function newProject() {
	const id = `p${short()}`;
	await sql`INSERT INTO projects (id, name, slug) VALUES (${id}, ${id}, ${id})`;
	return id;
}

async function newUser() {
	const id = `u${short()}`;
	await sql`INSERT INTO system_users (id, email, name) VALUES (${id}, ${`${id}@example.com`}, ${id})`;
	return id;
}

type As = { user: string; role?: string; admin?: boolean };

async function call(project: string, as: As, path = "", method = "GET", body?: unknown) {
	const headers: Record<string, string> = {
		"X-User": as.user,
		"X-Project": project,
		"X-Role": as.role ?? "creator",
		"content-type": "application/json",
	};
	if (as.admin) headers["X-Admin"] = "1";
	const res = await app.request(`http://localhost/projects/${project}/sandboxes${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as any };
}

async function create(project: string, as: As, name = "scratch") {
	const res = await call(project, as, "", "POST", { name });
	expect(res.status).toBe(200);
	return res.body.id as string;
}

/** a JS block between the entrypoint and a response */
async function addChain(project: string, as: As, id: string) {
	const canvas = (await call(project, as, `/${id}/canvas-items`)).body;
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const js = Bun.randomUUIDv7();
	const reply = Bun.randomUUIDv7();
	const edges = [
		{ id: Bun.randomUUIDv7(), from: entry, to: js, fromHandle: "source", toHandle: "source" },
		{ id: Bun.randomUUIDv7(), from: js, to: reply, fromHandle: "source", toHandle: "source" },
	];
	const blocks = [
		{ id: js, type: "jsrunner", position: { x: 240, y: 0 }, data: { value: "return 1;" } },
		{ id: reply, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
	];
	const res = await call(project, as, `/${id}/save-canvas`, "PUT", {
		actionsToPerform: {
			blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
			edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
		},
		changes: { blocks, edges },
	});
	expect(res.status).toBe(200);
}

describe("who sees a sandbox", () => {
	let project: string;
	let owner: As;
	let other: As;
	let admin: As;
	let id: string;

	beforeAll(async () => {
		project = await newProject();
		owner = { user: await newUser() };
		other = { user: await newUser() };
		admin = { user: await newUser(), admin: true };
		id = await create(project, owner);
	});

	it("lets the owner read, rename and change settings", async () => {
		const read = await call(project, owner, `/${id}`);
		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({ id, projectId: project, name: "scratch", settings: { tracingEnabled: false } });

		const patched = await call(project, owner, `/${id}`, "PATCH", { name: "renamed", settings: { tracingEnabled: true } });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ name: "renamed", settings: { tracingEnabled: true } });
	});

	it("is a 404 to another creator and to a system admin, on every endpoint", async () => {
		for (const as of [other, admin]) {
			for (const [path, method, body] of [
				[`/${id}`, "GET"],
				[`/${id}`, "PATCH", { name: "mine now" }],
				[`/${id}`, "DELETE"],
				[`/${id}/canvas-items`, "GET"],
				[`/${id}/canvas-version`, "GET"],
				[`/${id}/save-canvas`, "PUT", { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [], edges: [] } }],
				[`/${id}/run`, "POST", {}],
				[`/${id}/runs`, "GET"],
			] as const) {
				const res = await call(project, as, path, method, body);
				expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
			}
		}
		expect((await call(project, owner, `/${id}`)).body.name).toBe("renamed");
	});

	it("is a 404 when named under another project", async () => {
		const elsewhere = await newProject();
		expect((await call(elsewhere, owner, `/${id}`)).status).toBe(404);
	});

	it("lists only the caller's own sandboxes", async () => {
		const theirs = await create(project, other, "theirs");
		const mine = (await call(project, owner)).body.data.map((s: any) => s.id);
		expect(mine).toContain(id);
		expect(mine).not.toContain(theirs);
		expect((await call(project, other)).body.data.map((s: any) => s.id)).toEqual([theirs]);
		expect((await call(project, admin)).body.data).toEqual([]);
	});

	it("refuses a viewer", async () => {
		const viewer = { user: await newUser(), role: "viewer" };
		expect((await call(project, viewer, "", "POST", { name: "nope" })).status).toBe(403);
		expect((await call(project, viewer)).status).toBe(403);
	});
});

describe("compiling", () => {
	it("starts with an entrypoint and an error handler, and publishes both halves to development only", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);

		const canvas = (await call(project, owner, `/${id}/canvas-items`)).body;
		expect(canvas.blocks.map((b: any) => b.type).sort()).toEqual(["entrypoint", "error_handler"]);

		const puts = writes.filter((w) => w.op === "put");
		expect(puts.map((w) => `${w.env} ${w.key}`).sort()).toEqual([
			`development sandbox-workflow.${project}.${id}`,
			`development sandbox.${project}.${id}`,
		]);
		const [route, workflow] = [`sandbox.${project}.${id}`, `sandbox-workflow.${project}.${id}`].map(
			(key) => puts.find((w) => w.key === key)!.value,
		);
		expect(route).toMatchObject({ routeId: id, sandbox: true, recordExecution: true, tracingEnabled: false });
		expect(workflow).toMatchObject({ workflowId: id, sandbox: true, recordExecution: true });
	});

	it("recompiles on a canvas save and a settings change, and never writes production", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		await addChain(project, owner, id);
		await call(project, owner, `/${id}`, "PATCH", { settings: { tracingEnabled: true } });

		const routePuts = writes.filter((w) => w.op === "put" && w.key === `sandbox.${project}.${id}`);
		expect(routePuts).toHaveLength(3);
		expect(routePuts.at(-1)!.value.tracingEnabled).toBe(true);
		// the response block answers on the route half and is a plain terminal on the workflow half
		const workflow = writes.findLast((w) => w.key === `sandbox-workflow.${project}.${id}`)!.value;
		expect(routePuts.at(-1)!.value.source).not.toBe(workflow.source);
		expect(writes.filter((w) => w.env !== "development")).toEqual([]);
	});
});

describe("custom blocks", () => {
	it("are usable on a sandbox canvas, as on a route", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		const name = `user_defined.project.tag_${short()}`;
		await sql`INSERT INTO custom_blocks_list (id, name, label, project_id) VALUES (${`c${short()}`}, ${name}, 'Tag', ${project})`;
		// what the admin's custom block cache does on a change signal
		const { loadCustomBlocks } = await import("../../../../loaders/customBlocksLoader");
		await loadCustomBlocks();
		const block = { id: Bun.randomUUIDv7(), type: name, position: { x: 0, y: 0 }, data: { invoke: "sync" } };
		const res = await call(project, owner, `/${id}/save-canvas`, "PUT", {
			actionsToPerform: { blocks: [{ id: block.id, action: "upsert" }], edges: [] },
			changes: { blocks: [block], edges: [] },
		});
		expect(res.body).toMatchObject({ canvasVersion: expect.any(Number) });
	});
});

describe("deleting", () => {
	it("takes the canvas with it and drops both development artifacts", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		await addChain(project, owner, id);
		const count = async () => {
			const [blocks] = await sql`SELECT count(*)::int AS n FROM blocks WHERE sandbox_id = ${id}`;
			const [edges] = await sql`SELECT count(*)::int AS n FROM edges WHERE sandbox_id = ${id}`;
			return [blocks.n, edges.n];
		};
		expect(await count()).toEqual([4, 2]);
		writes.length = 0;

		expect((await call(project, owner, `/${id}`, "DELETE")).status).toBe(200);
		expect(await count()).toEqual([0, 0]);
		expect(writes.map((w) => `${w.op} ${w.env} ${w.key}`).sort()).toEqual([
			`delete development sandbox-workflow.${project}.${id}`,
			`delete development sandbox.${project}.${id}`,
		]);
		expect((await call(project, owner, `/${id}`)).status).toBe(404);
	});
});

describe("run as workflow", () => {
	it("is a 409 naming the fix when no development worker is running", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		devWorker = false;
		const res = await call(project, owner, `/${id}/run`, "POST", { payload: { n: 1 } });
		expect(res.status).toBe(409);
		expect(JSON.stringify(res.body)).toContain("start a worker with FLUXIFY_ENV=development");
		expect(fired).toEqual([]);
	});

	it("fires the sandbox on the development internal subject", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		const res = await call(project, owner, `/${id}/run`, "POST", { payload: { n: 1 } });
		expect(res.body).toEqual({ id: "job-1", accepted: true });
		expect(fired).toEqual([
			{
				env: "development",
				input: { projectId: project, workflowId: id, data: { n: 1 }, origin: { via: "manual", userId: owner.user } },
			},
		]);
	});
});

describe("recorded runs", () => {
	it("are listed and read by the owner only", async () => {
		const project = await newProject();
		const owner = { user: await newUser() };
		const id = await create(project, owner);
		const runId = crypto.randomUUID();
		await sql`INSERT INTO trace_runs (id, project_id, sandbox_id, started_at, outcome, span_count)
			VALUES (${runId}, ${project}, ${id}, now(), 'success', 0)`;

		const list = await call(project, owner, `/${id}/runs`);
		expect(list.body.data.map((r: any) => r.id)).toEqual([runId]);
		expect((await call(project, owner, `/${id}/runs/${runId}`)).body).toMatchObject({ id: runId, spans: [] });

		const other = { user: await newUser() };
		expect((await call(project, other, `/${id}/runs/${runId}`)).status).toBe(404);
	});
});

// Promote and rollback (#739) against a real Postgres and a real NATS: the HTTP
// API writes the deployment log and moves production's pointer, and the real
// compiler publishes what production would serve. Mocks would only prove the
// calls; the bucket proves what a worker would find.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-deployments-pg-test" };
const NATS = { image: "nats:2.14", name: "fluxify-deployments-nats-test" };
let pg: Docker.Container | undefined;
let nats: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const signals: { chan: string; id: unknown }[] = [];

const natsKv = await import("../../../db/natsKv");
const pubsub = await import("../../../db/pubsub");
const { routeKey, workflowKey } = await import("../../compiler/subjects");

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

	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		signals.push({ chan: String(chan), id });
	});

	const routes = (await import("../../../api/v1/routes/register")).default;
	const workflows = (await import("../../../api/v1/workflows/register")).default;
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
	workflows.registerHandler(app);
}, 240_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await closeNats().catch(() => {});
	await pg?.remove({ force: true }).catch(() => {});
	await nats?.remove({ force: true }).catch(() => {});
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

/** `active: true`, so only the missing promote keeps production from serving it */
async function createRoute(as: As, path = `/${short()}`, method = "GET") {
	const res = await call(as, "POST", "/routes", {
		name: `r-${short()}`,
		path,
		method,
		projectId: as.project,
		active: true,
	});
	expect(res.status).toBe(200);
	return res.body.id as string;
}

async function createWorkflow(as: As) {
	const res = await call(as, "POST", "/workflows", {
		name: `w-${short()}`,
		projectId: as.project,
		active: true,
	});
	expect(res.status).toBe(200);
	return res.body.id as string;
}

const canvas = async (as: As, kind: string, id: string) =>
	(await call(as, "GET", `/${kind}/${id}/canvas-items`)).body;

const JS = Bun.randomUUIDv7();
const REPLY = Bun.randomUUIDv7();

/** one JS block between the entrypoint and a response; calling again changes its script */
async function edit(as: As, kind: string, id: string, script: string) {
	const entry = (await canvas(as, kind, id)).blocks.find((b: any) => b.type === "entrypoint").id;
	const edges = [
		{ id: Bun.randomUUIDv7(), from: entry, to: JS, fromHandle: `${entry}-source`, toHandle: `${JS}-target` },
		{ id: Bun.randomUUIDv7(), from: JS, to: REPLY, fromHandle: `${JS}-source`, toHandle: `${REPLY}-target` },
	];
	const blocks = [
		{ id: JS, type: "jsrunner", position: { x: 240, y: 0 }, data: { value: script } },
		{ id: REPLY, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
	];
	const first = !(await canvas(as, kind, id)).blocks.some((b: any) => b.id === JS);
	const res = await call(as, "PUT", `/${kind}/${id}/save-canvas`, {
		actionsToPerform: {
			blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
			edges: first ? edges.map((e) => ({ id: e.id, action: "upsert" })) : [],
		},
		changes: { blocks, edges: first ? edges : [] },
	});
	expect(res.status).toBe(200);
}

const commit = async (as: As, kind: string, id: string, title: string) => {
	const res = await call(as, "POST", `/${kind}/${id}/versions`, { title });
	expect(res.status).toBe(200);
	return res.body.id as string;
};

const deploy = (as: As, kind: string, id: string, versionId: string, description = "go live") =>
	call(as, "POST", `/${kind}/${id}/deployments`, { versionId, description });

const compile = async (kind: "routes" | "workflows", id: string) => {
	const { compileRoute, compileWorkflow } = await import("../../compiler/service");
	await (kind === "routes" ? compileRoute(id) : compileWorkflow(id));
};

/** what a production or development worker would find for this route or workflow */
async function artifact(kind: "routes" | "workflows", project: string, id: string, env: "production" | "development") {
	const key = kind === "routes" ? routeKey(project, id) : workflowKey(project, id);
	return (await natsKv.getArtifact(key, env)) as Record<string, any> | null;
}

const prodArtifact = (kind: "routes" | "workflows", project: string, id: string) =>
	artifact(kind, project, id, "production");

/** a committed route whose JS block says `script`, ready to promote */
async function versioned(as: As, id: string, script: string) {
	await edit(as, "routes", id, script);
	return await commit(as, "routes", id, `v: ${script}`);
}

describe("promote", () => {
	it("serves nothing in production before a promote, even when active is on", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		await versioned(as, id, "return 1;");
		await compile("routes", id);

		expect(await prodArtifact("routes", project, id)).toBeNull();
		// development answers at once, from the working copy
		expect(await artifact("routes", project, id, "development")).toMatchObject({ routeId: id });
		expect((await call(as, "GET", `/routes/${id}`)).body).toMatchObject({
			active: true,
			prodVersionId: null,
			prodVersionNumber: null,
		});
	});

	it("promote v2 serves v2, an edit leaves production alone, rollback to v1 serves v1", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 'one';");
		const v2 = await versioned(as, id, "return 'two';");

		const first = await deploy(as, "routes", id, v1, "first release");
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({
			status: "live",
			action: "promote",
			versionNumber: 1,
			description: "first release",
			kind: "route",
			targetId: id,
		});
		expect(signals).toContainEqual({ chan: "chan:on-route-change", id });
		await compile("routes", id);
		const live1 = await prodArtifact("routes", project, id);
		expect(live1?.routeVersion).toBe(v1);
		expect(live1?.source).toContain("return 'one';");

		const second = await deploy(as, "routes", id, v2, "second release");
		expect(second.body).toMatchObject({ status: "live", action: "promote", versionNumber: 2 });
		await compile("routes", id);
		const live2 = await prodArtifact("routes", project, id);
		expect(live2?.routeVersion).toBe(v2);
		expect(live2?.source).toContain("return 'two';");

		// editing the working copy and recompiling must not touch production
		await edit(as, "routes", id, "return 'edited';");
		await compile("routes", id);
		const afterEdit = await prodArtifact("routes", project, id);
		expect(afterEdit?.routeVersion).toBe(v2);
		expect(afterEdit?.source).toBe(live2?.source);
		expect((await artifact("routes", project, id, "development"))?.source).toContain("return 'edited';");

		const back = await deploy(as, "routes", id, v1, "it broke");
		expect(back.body).toMatchObject({ status: "live", action: "rollback", versionNumber: 1 });
		await compile("routes", id);
		const rolledBack = await prodArtifact("routes", project, id);
		expect(rolledBack?.routeVersion).toBe(v1);
		expect(rolledBack?.source).toContain("return 'one';");

		const log = (await call(as, "GET", `/routes/${id}/deployments`)).body.deployments;
		expect(log.map((d: any) => [d.versionNumber, d.action, d.status])).toEqual([
			[1, "rollback", "live"],
			[2, "promote", "live"],
			[1, "promote", "live"],
		]);
		expect(log[0].description).toBe("it broke");
		expect(await call(as, "GET", `/routes/${id}`)).toMatchObject({
			body: { prodVersionNumber: 1, prodVersionId: v1 },
		});
		const versions = (await call(as, "GET", `/routes/${id}/versions`)).body.versions;
		expect(versions.map((v: any) => [v.versionNumber, v.isProd])).toEqual([
			[2, false],
			[1, true],
		]);
	});

	it("a settings save that sends the whole row back does not un-promote", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		await deploy(as, "routes", id, v1);
		const row = (await call(as, "GET", `/routes/${id}`)).body;

		await call(as, "PUT", `/routes/${id}`, { ...row, name: `renamed-${short()}` });
		expect((await call(as, "GET", `/routes/${id}`)).body.prodVersionId).toBe(v1);
	});

	it("refuses to promote the version that is already live", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		expect((await deploy(as, "routes", id, v1)).status).toBe(200);

		const again = await deploy(as, "routes", id, v1);
		expect(again.status).toBe(409);
		expect(again.body.message).toBe("v1 is already live in production");
		expect((await call(as, "GET", `/routes/${id}/deployments`)).body.deployments).toHaveLength(1);
	});

	it("needs a description, a version of this route, and the creator role", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const other = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const foreign = await versioned(as, other, "return 2;");

		expect((await call(as, "POST", `/routes/${id}/deployments`, { versionId: v1 })).status).toBe(400);
		expect((await deploy(as, "routes", id, v1, "   ")).status).toBe(400);
		expect((await deploy(as, "routes", id, foreign)).status).toBe(404);
		expect((await deploy({ ...as, role: "viewer" }, "routes", id, v1)).status).toBe(403);
		expect((await call({ ...as, role: "viewer" }, "GET", `/routes/${id}/deployments`)).status).toBe(200);
		expect((await call({ user: as.user, project: await newProject() }, "GET", `/routes/${id}/deployments`)).status).toBe(
			403,
		);
		expect(project).toBeTruthy();
	});

	it("keeps the author's email when the user is deleted", async () => {
		const { as, author } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const done = await deploy(as, "routes", id, v1);
		expect(done.body).toMatchObject({ author: author.email, authorEmail: author.email });

		await sql`DELETE FROM system_users WHERE id = ${author.id}`;
		const [log] = (await call(as, "GET", `/routes/${id}/deployments`)).body.deployments;
		expect(log).toMatchObject({ author: author.email, authorEmail: author.email });
		const [row] = await sql`SELECT author_id FROM deployments WHERE id = ${log.id}`;
		expect(row.author_id).toBeNull();
	});

	it("is deleted with its route", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		await deploy(as, "routes", id, v1);
		await sql`DELETE FROM routes WHERE id = ${id}`;
		expect(await sql`SELECT id FROM deployments WHERE route_id = ${id}`).toHaveLength(0);
	});

	it("polls one deployment, and never another route's", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const other = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const done = await deploy(as, "routes", id, v1);

		const same = await call(as, "GET", `/routes/${id}/deployments/${done.body.id}`);
		expect(same.body).toMatchObject({ id: done.body.id, status: "live" });
		expect((await call(as, "GET", `/routes/${other}/deployments/${done.body.id}`)).status).toBe(404);
	});
});

describe("gates", () => {
	/** replaces what the JS block holds in a committed version, as a deleted integration would read */
	async function withBlockData(versionId: string, data: unknown) {
		await sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{blocks}', (
				SELECT jsonb_agg(CASE WHEN b->>'type' = 'jsrunner' THEN jsonb_set(b, '{data}', ${JSON.stringify(data)}::text::jsonb) ELSE b END)
				FROM jsonb_array_elements(snapshot->'blocks') b))
			WHERE id = ${versionId}`;
	}

	it("fails and lists the app config keys and integrations production has no value for", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const ghost = Bun.randomUUIDv7();
		await withBlockData(v1, { value: "return 1;", token: "cfg:NO_SUCH_KEY", connection: ghost });

		signals.length = 0;
		const res = await deploy(as, "routes", id, v1);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("failed");
		const values = res.body.gates.find((g: any) => g.gate === "values");
		expect(values.status).toBe("failed");
		expect(values.items).toEqual([
			`integration ${ghost} no longer exists`,
			"app config key NO_SUCH_KEY has no production value",
		]);

		// nothing moved, and the attempt stays in the log
		expect((await call(as, "GET", `/routes/${id}`)).body.prodVersionId).toBeNull();
		const [log] = (await call(as, "GET", `/routes/${id}/deployments`)).body.deployments;
		expect(log).toMatchObject({ status: "failed", action: "promote" });
		expect(log.finishedAt).not.toBeNull();
		expect(signals.filter((s) => s.id === id && s.chan === "chan:on-route-change")).toHaveLength(0);
	});

	it("finds the app config keys a block's JavaScript reads, and passes when production has them", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const key = `KEY_${short()}`.toUpperCase();
		const v1 = await versioned(as, id, `const v = getConfig('${key}'); return v;`);

		const refused = await deploy(as, "routes", id, v1);
		expect(refused.body.status).toBe("failed");
		expect(refused.body.gates.find((g: any) => g.gate === "values").items).toEqual([
			`app config key ${key} has no production value`,
		]);

		await sql`INSERT INTO app_config (key_name, value, project_id, data_type, encoding_type)
			VALUES (${key}, 'x', ${project}, 'string', 'plaintext')`;
		const done = await deploy(as, "routes", id, v1);
		expect(done.body.status).toBe("live");
	});

	it("does not mistake a note that starts with cfg: for a reference", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		await withBlockData(v1, { value: "return 1;", blockDescription: "cfg:NOT_A_KEY", blockName: "cfg:NAME" });
		expect((await deploy(as, "routes", id, v1)).body.status).toBe("live");
	});

	it("a failed deployment leaves what production serves untouched", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 'one';");
		const v2 = await versioned(as, id, "return 'two';");
		await deploy(as, "routes", id, v1);
		await withBlockData(v2, { value: "return 'two';", token: "cfg:NO_SUCH_KEY" });

		expect((await deploy(as, "routes", id, v2)).body.status).toBe("failed");
		await compile("routes", id);
		expect((await prodArtifact("routes", project, id))?.routeVersion).toBe(v1);
		expect((await call(as, "GET", `/routes/${id}`)).body.prodVersionId).toBe(v1);
	});

	it("fails when another route's promoted version holds the same method and path", async () => {
		const { as } = await setup();
		const first = await createRoute(as, `/clash-${short()}`);
		const firstVersion = await versioned(as, first, "return 1;");
		const path = (await call(as, "GET", `/routes/${first}`)).body.path as string;
		expect((await deploy(as, "routes", first, firstVersion)).body.status).toBe("live");

		// the first route moves on, so its working copy no longer holds the path
		const moved = (await call(as, "GET", `/routes/${first}`)).body;
		const update = await call(as, "PUT", `/routes/${first}`, { ...moved, path: `/moved-${short()}` });
		expect(update.status).toBe(200);

		const second = await createRoute(as, path);
		const secondVersion = await versioned(as, second, "return 2;");
		const res = await deploy(as, "routes", second, secondVersion);
		expect(res.body.status).toBe("failed");
		const gate = res.body.gates.find((g: any) => g.gate === "path");
		expect(gate.status).toBe("failed");
		expect(gate.message).toContain(path);
		expect((await call(as, "GET", `/routes/${second}`)).body.prodVersionId).toBeNull();
	});

	it("allows a route to be promoted over its own earlier version's path", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const v2 = await versioned(as, id, "return 2;");
		await deploy(as, "routes", id, v1);
		const res = await deploy(as, "routes", id, v2);
		expect(res.body.status).toBe("live");
		expect(res.body.gates.find((g: any) => g.gate === "path").status).toBe("passed");
	});

	it("warns about custom blocks and middlewares and warns that there are no suites, neither a failure", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const middleware = Bun.randomUUIDv7();
		await sql`INSERT INTO middlewares (id, project_id, name) VALUES (${middleware}, ${project}, 'audit')`;
		await sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{settings,middlewares}', ${JSON.stringify({ before: [middleware], after: [] })}::text::jsonb)
			WHERE id = ${v1}`;

		const res = await deploy(as, "routes", id, v1);
		expect(res.body.status).toBe("live");
		const byGate = Object.fromEntries(res.body.gates.map((g: any) => [g.gate, g]));
		expect(byGate.custom_blocks).toMatchObject({ status: "warning", items: ["middleware audit"] });
		expect(byGate.custom_blocks.message).toContain("current state in production");
		expect(byGate.tests).toMatchObject({
			status: "warning",
			message: "No test suites: promoted without tests",
		});
		expect(byGate.values.status).toBe("passed");
		expect(byGate.compile.status).toBe("passed");
	});

	it("fails a version that no longer compiles", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		// the JS block is wired into the graph, so its missing type is reached
		await sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{blocks}', (
				SELECT jsonb_agg(CASE WHEN b->>'type' = 'jsrunner' THEN jsonb_set(b, '{type}', '"user_defined.project.deleted_block"') ELSE b END)
				FROM jsonb_array_elements(snapshot->'blocks') b))
			WHERE id = ${v1}`;

		const res = await deploy(as, "routes", id, v1);
		expect(res.body.status).toBe("failed");
		expect(res.body.gates.find((g: any) => g.gate === "compile").status).toBe("failed");
	});
});

describe("workflows", () => {
	it("promote and rollback work the same, and the artifact carries the version id", async () => {
		const { as, project } = await setup();
		const id = await createWorkflow(as);
		await edit(as, "workflows", id, "return 'one';");
		const v1 = await commit(as, "workflows", id, "one");
		await edit(as, "workflows", id, "return 'two';");
		const v2 = await commit(as, "workflows", id, "two");

		await compile("workflows", id);
		expect(await prodArtifact("workflows", project, id)).toBeNull();

		expect((await deploy(as, "workflows", id, v2)).body).toMatchObject({ status: "live", action: "promote" });
		await compile("workflows", id);
		expect((await prodArtifact("workflows", project, id))?.workflowVersion).toBe(v2);

		expect((await deploy(as, "workflows", id, v1)).body).toMatchObject({ status: "live", action: "rollback" });
		await compile("workflows", id);
		const live = await prodArtifact("workflows", project, id);
		expect(live?.workflowVersion).toBe(v1);
		expect(live?.source).toContain("return 'one';");
		expect((await call(as, "GET", `/workflows/${id}`)).body).toMatchObject({
			prodVersionId: v1,
			prodVersionNumber: 1,
		});
		expect((await deploy(as, "workflows", id, v1)).status).toBe(409);
	});
});

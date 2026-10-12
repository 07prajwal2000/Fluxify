// The tests gate and production test runs (#739) against a
// real Postgres and a real NATS. A fake development worker answers on the real
// bus, so the runner, the bucket and the sealed bootstrap are the real ones.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-testsgate-pg-test" };
const NATS = { image: "nats:2.14", name: "fluxify-testsgate-nats-test" };
let pg: Docker.Container | undefined;
let nats: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const signals: { chan: string; id: unknown }[] = [];

// sealing the suite bootstrap needs the master key before the env module is read
process.env.MASTER_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

const natsKv = await import("../../../db/natsKv");
const pubsub = await import("../../../db/pubsub");
const { routeKey, workflowKey } = await import("../../compiler/subjects");
const { natsConnection, natsName } = await import("../../../db/nats");
const { EncryptionService } = await import("../../../lib/encryption");
const { testRunSubject } = await import("../../testRunner/types");

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
	const testSuites = (await import("../../../api/v1/test-suites/register")).default;
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
	testSuites.registerHandler(app);
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

// The tests gate (#739): the suites of a route run against a candidate compiled
// from the version being promoted. A fake development worker answers on the
// real bus, so the real runner, the real bucket and the real sealed bootstrap are
// all in the path; only the user code a worker would run is replaced.
describe("tests gate", () => {
	const responders: RpcResponder[] = [];
	afterAll(() => Promise.all(responders.map((r) => r.stop())));

	const PASS = {
		ok: true,
		status: 200,
		data: {},
		headers: {},
		durationMs: 3,
		verdict: { success: true, result: [] },
	};
	const FAIL = {
		...PASS,
		status: 500,
		verdict: {
			success: false,
			result: [{ success: false, message: "Expected Status to eq 200, got: 500" }],
		},
	};

	/** answers suite runs for a project as its development worker would, and records what it was given */
	function devWorker(project: string, answer: (bootstrap: any) => unknown) {
		const seen: { bootstrap: any }[] = [];
		responders.push(
			rpcRespond<{ sealed: string }, any>(
				natsConnection(),
				natsName(testRunSubject(project), "development"),
				async ({ sealed }) => {
					const bootstrap = JSON.parse(EncryptionService.decrypt(sealed));
					seen.push({ bootstrap });
					return answer(bootstrap);
				},
			),
		);
		return seen;
	}

	async function suite(routeId: string, name = `suite-${short()}`) {
		const id = `s${short()}`;
		await sql`INSERT INTO test_suites (id, name, route_id) VALUES (${id}, ${name}, ${routeId})`;
		return { id, name };
	}

	async function until<T>(what: string, probe: () => Promise<T | false>) {
		for (let i = 0; i < 100; i++) {
			const value = await probe();
			if (value) return value;
			await Bun.sleep(100);
		}
		throw new Error(`timed out waiting for ${what}`);
	}

	const finished = (as: As, id: string, deploymentId: string) =>
		until("the deployment to finish", async () => {
			const d = (await call(as, "GET", `/routes/${id}/deployments/${deploymentId}`)).body;
			return d.status !== "pending" && d;
		});

	it("runs the suite on the version's graph, not the working copy, with development values, and goes live", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const key = `CFG_${short()}`.toUpperCase();
		await sql`INSERT INTO app_config (key_name, value, dev_value, sync_dev, project_id, data_type, encoding_type)
			VALUES (${key}, 'prod-value', 'dev-value', false, ${project}, 'string', 'plaintext')`;
		const v1 = await versioned(as, id, `return getConfig('${key}') + ' from v1';`);
		const s = await suite(id);
		// the working copy moves on; the gate must still test v1
		await edit(as, "routes", id, "return 'working copy';");
		const seen = devWorker(project, () => PASS);

		const started = await deploy(as, "routes", id, v1);
		expect(started.status).toBe(200);
		// suites take time, so the request answers with the pending deployment
		expect(started.body.status).toBe("pending");
		const done = await finished(as, id, started.body.id);

		expect(done.status).toBe("live");
		expect(done.gates.at(-1)).toMatchObject({ gate: "tests", status: "passed" });
		expect(seen).toHaveLength(1);
		const { bootstrap } = seen[0]!;
		expect(bootstrap.suite.id).toBe(s.id);
		expect(bootstrap.source).toContain(" from v1");
		expect(bootstrap.source).not.toContain("working copy");
		expect(bootstrap.config.appConfig[key]).toBe("dev-value");

		// the run is in the history like any other, tagged with the deployment
		const [run] = await sql`SELECT env, deployment_id, status FROM test_runs WHERE route_id = ${id}`;
		expect(run).toMatchObject({ env: "production", deployment_id: started.body.id, status: "passed" });
		expect((await call(as, "GET", `/routes/${id}`)).body.prodVersionId).toBe(v1);
	});

	it("a failing suite fails the deployment, with the suite, the check and the error", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		const s = await suite(id, "orders are listed");
		devWorker(project, () => FAIL);

		const started = await deploy(as, "routes", id, v1);
		const done = await finished(as, id, started.body.id);

		expect(done.status).toBe("failed");
		const tests = done.gates.find((g: any) => g.gate === "tests");
		expect(tests).toMatchObject({ status: "failed", message: "1 of 1 test suites did not pass" });
		expect(tests.items).toEqual([`${s.name}: Expected Status to eq 200, got: 500`]);
		// the failing run is named, so the promotion panel can link to it (#739)
		const [run] = await sql`SELECT id FROM test_runs WHERE route_id = ${id}`;
		expect(tests.runId).toBe(run!.id);
		// production keeps what it had
		expect((await call(as, "GET", `/routes/${id}`)).body.prodVersionId).toBeNull();
	});

	it("no suites: goes live at once, with the warning", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");

		const res = await deploy(as, "routes", id, v1);
		expect(res.body.status).toBe("live");
		expect(res.body.gates.at(-1)).toMatchObject({
			gate: "tests",
			status: "warning",
			message: "No test suites: promoted without tests",
		});
	});

	it("no development worker: the gate fails and says how to start one", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		await suite(id);

		const started = await deploy(as, "routes", id, v1);
		const done = await finished(as, id, started.body.id);

		expect(done.status).toBe("failed");
		const tests = done.gates.at(-1);
		expect(tests.status).toBe("failed");
		expect(tests.message).toContain("start a worker with FLUXIFY_ENV=development");
	});

	it("does not run the suites when an earlier check already failed", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 1;");
		await sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{blocks}', (
				SELECT jsonb_agg(CASE WHEN b->>'type' = 'jsrunner' THEN jsonb_set(b, '{data}', '{"value":"return 1;","k":"cfg:NO_SUCH_KEY"}') ELSE b END)
				FROM jsonb_array_elements(snapshot->'blocks') b))
			WHERE id = ${v1}`;
		await suite(id);
		const seen = devWorker(project, () => PASS);

		const res = await deploy(as, "routes", id, v1);
		// nothing to wait for: the request has the final answer
		expect(res.body.status).toBe("failed");
		expect(res.body.gates.at(-1)).toMatchObject({ gate: "tests", status: "skipped" });
		expect(seen).toHaveLength(0);
	});
});

describe("production test run", () => {
	const runsPath = (project: string, id: string) => `/${project}/test-suites/route/${id}/runs`;

	async function runSuites(as: As, id: string, body: unknown) {
		const started = await call(as, "POST", runsPath(as.project, id), body);
		if (started.status !== 202) return started;
		const runId = started.body.runId;
		for (let i = 0; i < 100; i++) {
			const run = await call(as, "GET", `${runsPath(as.project, id)}/${runId}`);
			if (!["queued", "running"].includes(run.body.status)) return run;
			await Bun.sleep(100);
		}
		throw new Error("the run never finished");
	}

	it("runs the promoted version, not the working copy, with development values", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const v1 = await versioned(as, id, "return 'promoted';");
		// no suites yet, so the promote is immediate
		expect((await deploy(as, "routes", id, v1)).body.status).toBe("live");
		await sql`INSERT INTO test_suites (id, name, route_id) VALUES (${`s${short()}`}, 'one', ${id})`;
		await edit(as, "routes", id, "return 'working copy';");

		const seen: any[] = [];
		const responder = rpcRespond<{ sealed: string }, any>(
			natsConnection(),
			natsName(testRunSubject(project), "development"),
			async ({ sealed }) => {
				seen.push(JSON.parse(EncryptionService.decrypt(sealed)));
				return {
					ok: true,
					status: 200,
					data: {},
					headers: {},
					durationMs: 1,
					verdict: { success: true, result: [] },
				};
			},
		);
		try {
			const dev = await runSuites(as, id, {});
			expect(dev.body).toMatchObject({ env: "development", status: "passed" });
			expect(seen.at(-1).source).toContain("working copy");

			const prod = await runSuites(as, id, { env: "production" });
			expect(prod.body).toMatchObject({ env: "production", status: "passed" });
			expect(seen.at(-1).source).toContain("promoted");
			expect(seen.at(-1).source).not.toContain("working copy");

			const list = (await call(as, "GET", runsPath(project, id))).body.data;
			expect(list.map((r: any) => r.env).sort()).toEqual(["development", "production"]);
		} finally {
			await responder.stop();
		}
	});

	it("is a 409 when nothing is promoted yet", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await sql`INSERT INTO test_suites (id, name, route_id) VALUES (${`s${short()}`}, 'one', ${id})`;

		const res = await call(as, "POST", runsPath(as.project, id), { env: "production" });
		expect(res.status).toBe(409);
		expect(res.body.message).toBe("Not promoted yet");
	});
});

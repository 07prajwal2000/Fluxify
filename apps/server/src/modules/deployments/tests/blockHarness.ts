// What the custom block and middleware version tests (#740) share: a real
// Postgres and a real NATS, the real routers on a Hono app, and a fake
// development worker that answers suite runs on the real bus. It is a helper, not
// a test file: each test file starts its own stack, so they never share a database.
import { expect, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

// sealing the suite bootstrap needs the master key before the env module is read
process.env.MASTER_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

export type As = { user: string; project: string; role?: string };
export type Kind = "routes" | "workflows" | "custom-blocks" | "middlewares";

export const short = () => crypto.randomUUID().slice(0, 8);

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

export const PASS = {
	ok: true,
	status: 200,
	data: {},
	headers: {},
	durationMs: 3,
	verdict: { success: true, result: [] },
};
export const FAIL = {
	...PASS,
	status: 500,
	verdict: {
		success: false,
		result: [{ success: false, message: "Expected Status to eq 200, got: 500" }],
	},
};

/** a suite run as the development worker received it: what the gate gave it to run */
export type SeenRun = {
	suite: { id: string; name: string };
	/** the route's or workflow's compiled graph */
	source: string;
	/** the custom block library the suite ran with, by name */
	library: Record<string, string>;
	middlewares?: { before: { name: string; blocks: string[] }[]; after: { name: string; blocks: string[] }[] };
	setup?: { block: string };
};

export async function createStack(prefix: string) {
	const PG = { image: "postgres:16-alpine", name: `fluxify-${prefix}-pg-test` };
	const NATS = { image: "nats:2.14", name: `fluxify-${prefix}-nats-test` };
	let pg: Docker.Container | undefined;
	let nats: Docker.Container | undefined;
	const responders: RpcResponder[] = [];
	const signals: { chan: string; id: unknown }[] = [];

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
	const sql = new SQL(url);
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
	const natsKv = await import("../../../db/natsKv");
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

	const pubsub = await import("../../../db/pubsub");
	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		signals.push({ chan: String(chan), id });
	});

	// a middleware has its own compile request instead of a change channel
	const publisher = await import("../../compiler/publisher");
	spyOn(publisher, "requestMiddlewareCompile").mockImplementation(async (id) => {
		signals.push({ chan: "compile:middleware", id });
	});

	const app = new Hono<any>();
	const { errorHandler } = await import("../../../middlewares/errorHandler");
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		const project = ctx.req.header("X-Project");
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: false });
		ctx.set("acl", [{ projectId: project, role: ctx.req.header("X-Role") ?? "creator" }]);
		await next();
	});
	for (const path of [
		"routes",
		"workflows",
		"custom-blocks",
		"middlewares",
		"test-suites",
	] as const) {
		(await import(`../../../api/v1/${path}/register`)).default.registerHandler(app);
	}

	const subjects = await import("../../compiler/subjects");
	const compiler = await import("../../compiler/service");
	const { natsConnection, natsName } = await import("../../../db/nats");
	const { EncryptionService } = await import("../../../lib/encryption");
	const { testRunSubject } = await import("../../testRunner/types");

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
		const project = Bun.randomUUIDv7();
		await sql`INSERT INTO projects (id, name, slug) VALUES (${project}, ${project}, ${project})`;
		const user = `u${short()}`;
		await sql`INSERT INTO system_users (id, email, name) VALUES (${user}, ${`${user}@example.com`}, ${null})`;
		return { project, userId: user, as: { user, project } as As };
	}

	async function createRoute(as: As, active = true) {
		const res = await call(as, "POST", "/routes", {
			name: `r-${short()}`,
			path: `/${short()}`,
			method: "GET",
			projectId: as.project,
			active,
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

	/** a custom block; `name` is the stored one, which is also the type a canvas gives it */
	async function createBlock(as: As, usage: "flow" | "middleware" | "test" = "flow") {
		const name = `b${short()}`;
		const res = await call(as, "POST", "/custom-blocks", {
			name,
			label: name,
			projectId: as.project,
			usage,
		});
		expect(res.status).toBe(200);
		const id = res.body.id as string;
		const full = (await call(as, "GET", `/custom-blocks/${id}`)).body;
		return { id, name: full.name as string };
	}

	async function createMiddleware(as: As, blocks: string[] = []) {
		const name = `m${short()}`;
		const res = await call(as, "POST", "/middlewares", { projectId: as.project, name, blocks });
		expect(res.status).toBe(200);
		return { id: res.body.id as string, name };
	}

	const canvas = async (as: As, kind: Kind, id: string) =>
		(await call(as, "GET", `/${kind}/${id}/canvas-items`)).body;

	/** the ids of the one block a test puts between a canvas's entrypoint and its response */
	const slots = new Map<string, { mid: string; reply: string }>();

	/**
	 * entry -> one block of `type` with `data` (-> a response, for a route). Calling
	 * again changes that block in place, which is an edit of the working copy.
	 */
	async function setBlock(as: As, kind: Kind, id: string, type: string, data: object) {
		let slot = slots.get(id);
		const first = !slot;
		if (!slot) {
			slot = { mid: Bun.randomUUIDv7(), reply: Bun.randomUUIDv7() };
			slots.set(id, slot);
		}
		const entry = (await canvas(as, kind, id)).blocks.find((b: any) => b.type === "entrypoint").id;
		const blocks: any[] = [{ id: slot.mid, type, position: { x: 240, y: 0 }, data }];
		const edges: any[] = [
			{
				id: Bun.randomUUIDv7(),
				from: entry,
				to: slot.mid,
				fromHandle: `${entry}-source`,
				toHandle: `${slot.mid}-target`,
			},
		];
		if (kind === "routes") {
			blocks.push({ id: slot.reply, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } });
			edges.push({
				id: Bun.randomUUIDv7(),
				from: slot.mid,
				to: slot.reply,
				fromHandle: `${slot.mid}-source`,
				toHandle: `${slot.reply}-target`,
			});
		}
		const res = await call(as, "PUT", `/${kind}/${id}/save-canvas`, {
			actionsToPerform: {
				blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
				edges: first ? edges.map((e) => ({ id: e.id, action: "upsert" })) : [],
			},
			changes: { blocks, edges: first ? edges : [] },
		});
		expect(res.status).toBe(200);
	}

	/** a JS block that says `script` */
	const setScript = (as: As, kind: Kind, id: string, script: string) =>
		setBlock(as, kind, id, "jsrunner", { value: script });

	/** a block that calls the custom block `name`; `extra` is configuration the caller passes it */
	const callBlock = (as: As, kind: Kind, id: string, name: string, extra: object = {}) =>
		setBlock(as, kind, id, name, { invoke: "sync", ...extra });

	async function commit(as: As, kind: Kind, id: string, title: string) {
		const res = await call(as, "POST", `/${kind}/${id}/versions`, { title });
		expect(res.status).toBe(200);
		return res.body.id as string;
	}

	/** commit what the canvas says now and put it live, waiting for its suites if it has any */
	async function release(as: As, kind: Kind, id: string) {
		const versionId = await commit(as, kind, id, `release ${short()}`);
		const res = await deployed(as, kind, id, versionId);
		expect(res.status).toBe("live");
		return versionId;
	}

	const deploy = (as: As, kind: Kind, id: string, versionId: string, description = "go live") =>
		call(as, "POST", `/${kind}/${id}/deployments`, { versionId, description });

	/** a deployment that waits for its suites, polled until it ends */
	async function deployed(as: As, kind: Kind, id: string, versionId: string) {
		const started = await deploy(as, kind, id, versionId);
		expect(started.status).toBe(200);
		let deployment = started.body;
		for (let i = 0; deployment.status === "pending" && i < 300; i++) {
			await Bun.sleep(100);
			deployment = (await call(as, "GET", `/${kind}/${id}/deployments/${deployment.id}`)).body;
		}
		return deployment;
	}

	const gate = (deployment: any, name: string) => deployment.gates.find((g: any) => g.gate === name);

	/** what a production or development worker would find for this block, middleware or route */
	const artifact = async (key: string, env: "production" | "development") =>
		(await natsKv.getArtifact(key, env)) as Record<string, any> | null;

	const blockArtifact = (project: string, id: string, env: "production" | "development") =>
		artifact(subjects.customBlockKey(project, id), env);
	const middlewareArtifact = (project: string, id: string, env: "production" | "development") =>
		artifact(subjects.middlewareKey(project, id), env);
	const routeArtifact = (project: string, id: string, env: "production" | "development") =>
		artifact(subjects.routeKey(project, id), env);

	/** the compiler's work, run by hand: the change signal is a spy here */
	const compileBlock = (id: string) => compiler.compileCustomBlock(id);
	const compileMiddleware = (id: string) => compiler.compileMiddleware(id);
	const compileRoute = (id: string) => compiler.compileRoute(id);

	async function suite(as: As, target: { routeId?: string; workflowId?: string }, hooks: { setup?: string; teardown?: string; loader?: string } = {}) {
		const id = `s${short()}`;
		const name = `suite-${short()}`;
		const input = hooks.loader
			? JSON.stringify({ source: "loader", mode: "single", loaderBlockId: hooks.loader })
			: null;
		await sql`INSERT INTO test_suites (id, name, route_id, workflow_id, setup_block_id, teardown_block_id, input)
			VALUES (${id}, ${name}, ${target.routeId ?? null}, ${target.workflowId ?? null},
				${hooks.setup ?? null}, ${hooks.teardown ?? null}, ${input}::text::jsonb)`;
		return { id, name };
	}

	/**
	 * Answers suite runs for a project as its development worker would, and
	 * records what each was given. `answer` picks the verdict.
	 */
	function devWorker(project: string, answer: (run: SeenRun) => unknown = () => PASS) {
		const seen: SeenRun[] = [];
		responders.push(
			rpcRespond<{ sealed: string }, any>(
				natsConnection(),
				natsName(testRunSubject(project), "development"),
				async ({ sealed }) => {
					const bootstrap = JSON.parse(EncryptionService.decrypt(sealed));
					const run: SeenRun = {
						suite: bootstrap.suite,
						source: bootstrap.source,
						library: Object.fromEntries(
							(bootstrap.customBlocks as { name: string; source: string }[]).map((b) => [b.name, b.source]),
						),
						middlewares: bootstrap.route?.middlewares,
						setup: bootstrap.setup,
					};
					seen.push(run);
					return answer(run);
				},
			),
		);
		return seen;
	}

	return {
		sql,
		app,
		signals,
		call,
		setup,
		createRoute,
		createWorkflow,
		createBlock,
		createMiddleware,
		canvas,
		setBlock,
		setScript,
		callBlock,
		commit,
		release,
		deploy,
		deployed,
		gate,
		blockArtifact,
		middlewareArtifact,
		routeArtifact,
		compileBlock,
		compileMiddleware,
		compileRoute,
		suite,
		devWorker,
		async stop() {
			await Promise.all(responders.map((r) => r.stop()));
			await sql.close().catch(() => {});
			await closeNats().catch(() => {});
			await pg?.remove({ force: true }).catch(() => {});
			await nats?.remove({ force: true }).catch(() => {});
		},
	};
}

export type Stack = Awaited<ReturnType<typeof createStack>>;

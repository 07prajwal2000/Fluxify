// Admin -> worker integration ops (I3) on a real NATS, against a real Postgres. The
// admin side is `runIntegrationOp`; the worker side is `serveIntegrationOps`, holding
// each environment's project config as a worker would. Only the broker proves the
// subjects, the queue group and the environment split; only the database proves the
// worker resolved the password from its own app config.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BUILT_IN_VARIANTS, IntegrationRegistry } from "@fluxify/adapters/integrations";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, type RpcResponder } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { z } from "zod";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const { runIntegrationOp } = await import("../dispatch");
const { serveIntegrationOps } = await import("../workerHost");

const NAMES = { nats: "fluxify-integration-ops-nats-test", pg: "fluxify-integration-ops-pg-test" };
const PROJECT = "p1";
/** served by a production worker only */
const PROD_ONLY = "p2";
const PASSWORD = "s3cret-pass";
const TABLE = `ops_${crypto.randomUUID().slice(0, 8)}`;
const containers: Docker.Container[] = [];
const responders: RpcResponder[] = [];
let pgPort = 0;

/** a variant only the worker knows, standing in for a plugin's (I6) */
const workerRegistry = new IntegrationRegistry(BUILT_IN_VARIANTS);
workerRegistry.register({
	group: "acme/crm",
	variant: "Hub",
	label: "Hub",
	configSchema: z.object({ token: z.string() }),
	test: async (_config: unknown, ctx: any) =>
		ctx.appConfig.get("HUB_TOKEN") === "dev-token"
			? { success: true, error: "" }
			: { success: false, error: "bad token" },
	inspectRequest: z.object({ object: z.string() }),
	inspect: async (_config: unknown, request: { object: string }) => ({ object: request.object, fields: ["id", "name"] }),
} as any);

/** what each environment's worker holds: the password only lives here */
const configFor = (env: string) => ({
	appConfig: { PG_PASS: PASSWORD, HUB_TOKEN: `${env === "development" ? "dev" : "prod"}-token` },
	dbIntegrations: {},
	kvIntegrations: {},
	observabilityIntegrations: {},
	aiIntegrations: {},
	projectSettings: {},
});

const pg = () => ({
	dbType: "PostgreSQL",
	source: "credentials",
	host: "127.0.0.1",
	port: String(pgPort),
	username: "postgres",
	password: "cfg:PG_PASS",
	database: "testdb",
	ssl: "false",
});

async function start(name: string, image: string, create: (port: number) => Docker.ContainerCreateOptions) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
	await pullImage(image);
	const started = await startContainerWithRandomPort((port) => docker.createContainer(create(port)));
	containers.push(started.container);
	return started.port;
}

async function poll(ready: () => Promise<unknown>, tries = 90) {
	for (let i = 0; ; i++) {
		try {
			return await ready();
		} catch (error) {
			if (i >= tries) throw error;
			await Bun.sleep(500);
		}
	}
}

beforeAll(async () => {
	const [natsPort, port] = await Promise.all([
		start(NAMES.nats, "nats:2.14", (p) => ({
			Image: "nats:2.14",
			name: NAMES.nats,
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(p) }] } },
			ExposedPorts: { "4222/tcp": {} },
		})),
		start(NAMES.pg, "postgres:bullseye", (p) => ({
			Image: "postgres:bullseye",
			name: NAMES.pg,
			Env: ["POSTGRES_USER=postgres", `POSTGRES_PASSWORD=${PASSWORD}`, "POSTGRES_DB=testdb"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(p) }] } },
		})),
	]);
	pgPort = port;
	await poll(() => connectNats({ servers: `nats://127.0.0.1:${natsPort}` }));
	await poll(async () => {
		const sql = new SQL(`postgres://postgres:${PASSWORD}@127.0.0.1:${pgPort}/testdb`, { max: 1 });
		try {
			await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int primary key, name text)`);
		} finally {
			await sql.close();
		}
	});

	// the project on both environments' workers; p2 on production's only
	responders.push(
		serveIntegrationOps(PROJECT, "development", () => configFor("development") as any, { registry: workerRegistry }),
		serveIntegrationOps(PROJECT, "production", () => configFor("production") as any, { registry: workerRegistry }),
		serveIntegrationOps(PROD_ONLY, "production", () => configFor("production") as any, { registry: workerRegistry }),
	);
}, 180_000);

afterAll(async () => {
	await Promise.allSettled(responders.map((r) => r.stop()));
	await closeNats().catch(() => {});
	await Promise.all(containers.map((c) => c.remove({ force: true }).catch(() => {})));
});

const target = (over: object = {}) => ({
	projectId: PROJECT,
	env: "development" as const,
	group: "database",
	variant: "PostgreSQL",
	config: pg(),
	...over,
});

describe("integration ops on a worker", () => {
	it("tests a built-in forced to a worker, which resolves the password itself", async () => {
		expect(await runIntegrationOp("test", target(), { mode: "worker" })).toEqual({ success: true, error: "" });
	});

	it("reports a wrong password as the driver's failure, not a transport error", async () => {
		const result: any = await runIntegrationOp("test", target({ config: { ...pg(), password: "nope" } }), {
			mode: "worker",
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/password|auth/i);
	});

	it("describes the database from the worker", async () => {
		const result: any = await runIntegrationOp("describe", target(), { mode: "worker" });
		expect(result.tables.find((t: any) => t.table === TABLE)?.columns.map((c: any) => c.name)).toEqual(["id", "name"]);
	});

	it("inspects the database from the worker", async () => {
		const result: any = await runIntegrationOp("inspect", target({ request: { tables: [TABLE] } }), {
			mode: "worker",
		});
		expect(JSON.stringify(result)).toContain("name");
	});

	it("a variant only the worker has answers test and inspect, with its env's values", async () => {
		const hub = { group: "acme/crm", variant: "Hub", config: { token: "cfg:HUB_TOKEN" } };
		expect(await runIntegrationOp("test", target(hub))).toEqual({ success: true, error: "" });
		expect(await runIntegrationOp("test", target({ ...hub, env: "production" }))).toEqual({
			success: false,
			error: "bad token",
		});
		expect(await runIntegrationOp("inspect", target({ ...hub, request: { object: "deal" } }))).toEqual({
			object: "deal",
			fields: ["id", "name"],
		});
	});

	it("a variant no worker has is named", async () => {
		await expect(runIntegrationOp("test", target({ group: "acme/crm", variant: "Gone" }))).rejects.toThrow(
			'Integration variant "acme/crm/Gone" is not installed on this development worker',
		);
	});

	it("a development request never reaches a production-only worker", async () => {
		await expect(runIntegrationOp("test", target({ projectId: PROD_ONLY }), { mode: "worker" })).rejects.toThrow(
			"No development worker is running for this project",
		);
		expect(await runIntegrationOp("test", target({ projectId: PROD_ONLY, env: "production" }), { mode: "worker" }))
			.toEqual({ success: true, error: "" });
	});

	it("a stopped worker is 'no worker', well inside the timeout", async () => {
		await responders.shift()!.stop();
		const startedAt = Date.now();
		await expect(runIntegrationOp("test", target(), { mode: "worker" })).rejects.toThrow(
			"No development worker is running for this project",
		);
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});
});

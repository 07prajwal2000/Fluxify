// Which plugin triggers scale their claim on lag (#963), against a real Postgres.
// The question is answered in SQL — a `->>` on the `source` jsonb, the `like` on
// the type, the two switches — so a mock would only prove what the code says. The
// real migrations run; FK checks are switched off for the table so the rows need
// no project, group or workflow of their own. Whether a kind still defines `lag`
// is the plugin store's answer, handed in.
//
// `bun test apps/server/src/modules/orchestrator/tests/pluginLagTriggers.test.ts`
// while developing; CI runs it with the integration suite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";

const IMAGE = "postgres:bullseye";
const NAME = "fluxify-plugin-lag-test";
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1";
const KIND = "acme/pg/poller";
let container: Docker.Container;
let client: SQL;
let lag: typeof import("../pluginLagTriggers");

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const base = `${ADMIN_URL}:${started.port}`;
	for (let attempt = 0; ; attempt++) {
		const probe = new SQL(`${base}/postgres`, { max: 1 });
		try {
			await probe`SELECT 1`;
			await probe.close();
			break;
		} catch (error) {
			await probe.close().catch(() => {});
			if (attempt >= 90) throw error;
			await Bun.sleep(500);
		}
	}
	const name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new SQL(`${base}/postgres`, { max: 1 });
	await admin.unsafe(`CREATE DATABASE ${name}`);
	await admin.close();
	client = new SQL(`${base}/${name}`, { max: 1 });
	// `lib/env` reads and caches `PG_URL` on its first import: set before the modules load
	process.env.PG_URL = `${base}/${name}`;
	process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
	const { drizzleInit } = await import("../../../db");
	await drizzleInit(true);
	await client`ALTER TABLE triggers DISABLE TRIGGER ALL`;
	lag = await import("../pluginLagTriggers");
}, 240_000);

afterAll(async () => {
	await client?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

beforeEach(async () => {
	await client`TRUNCATE triggers CASCADE`;
});

type Row = {
	type?: string;
	source?: unknown;
	group?: string;
	workflow?: string | null;
	active?: boolean;
	devActive?: boolean;
};
async function insert({
	type = `plugin:${KIND}`,
	source = { lagPerWorker: 50 },
	group = "g1",
	workflow = "wf1",
	active = true,
	devActive = false,
}: Row = {}) {
	const id = crypto.randomUUID();
	await client`
		INSERT INTO triggers (id, name, type, project_id, group_id, workflow_id, source, active, dev_active)
		VALUES (${id}, ${`t-${id}`}, ${type}, 'p1', ${group}, ${workflow}, ${JSON.stringify(source)}::text::jsonb, ${active}, ${devActive})`;
	return id;
}
const defines = (answer: boolean) => async () => answer;

describe("plugin triggers that scale on lag", () => {
	it("a trigger with a lagPerWorker scales its group's claim on it, with the derived token", async () => {
		const id = await insert();
		const byGroup = await lag.pluginLagTriggersByGroup(defines(true));
		expect(byGroup.get("g1")).toEqual([
			{ id, type: "plugin-lag", lagPerWorker: 50, token: expect.stringMatching(/^[0-9a-f]{64}$/) },
		]);
	});

	it("each group keeps its own triggers, and several in one group all count", async () => {
		const a = await insert({ group: "g1" });
		const b = await insert({ group: "g1", source: { lagPerWorker: 5 } });
		const c = await insert({ group: "g2" });
		const byGroup = await lag.pluginLagTriggersByGroup(defines(true));
		expect(byGroup.get("g1")?.map((t) => t.id).sort()).toEqual([a, b].sort());
		expect(byGroup.get("g2")?.map((t) => t.id)).toEqual([c]);
	});

	it("skips a trigger with no value: it keeps scaling on cpu and memory", async () => {
		await insert({ source: { table: "orders" } });
		await insert({ source: null });
		expect((await lag.pluginLagTriggersByGroup(defines(true))).size).toBe(0);
	});

	it("skips a value that is not a whole number of at least 1, which KEDA would divide by", async () => {
		for (const bad of [0, -3, 1.5, "50", null]) await insert({ source: { lagPerWorker: bad } });
		expect((await lag.pluginLagTriggersByGroup(defines(true))).size).toBe(0);
	});

	it("skips a kind whose current version no longer defines lag", async () => {
		await insert();
		expect((await lag.pluginLagTriggersByGroup(defines(false))).size).toBe(0);
	});

	it("asks the plugin store once per project and kind", async () => {
		await insert();
		await insert();
		let asked = 0;
		await lag.pluginLagTriggersByGroup(async () => {
			asked++;
			return true;
		});
		expect(asked).toBe(1);
	});

	it("needs a workflow and a switch on in either environment", async () => {
		await insert({ workflow: null });
		await insert({ active: false, devActive: false });
		expect((await lag.pluginLagTriggersByGroup(defines(true))).size).toBe(0);
		const dev = await insert({ active: false, devActive: true });
		expect((await lag.pluginLagTriggersByGroup(defines(true))).get("g1")?.[0]?.id).toBe(dev);
	});

	it("ignores built-in connectors and internal triggers even with the same key in their source", async () => {
		await insert({ type: "kafka" });
		await insert({ type: "internal" });
		expect((await lag.pluginLagTriggersByGroup(defines(true))).size).toBe(0);
	});
});

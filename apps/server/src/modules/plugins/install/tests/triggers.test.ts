// Plugin triggers (T2) end to end: a real NATS and Postgres behind the plugins,
// triggers and integrations API, and a real worker install. What a user does:
// upload and approve a plugin with a trigger, create a trigger of its kind,
// see its artifact published and its code reach the worker's refs, then
// disable, upgrade, delete an integration it uses, and remove the plugin.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { faker } from "@faker-js/faker";
import { param } from "@fluxify/sdk/blocks";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { pluginStatusKey } = await import("@fluxify/common/orchestrator");
const { setup, startStack, stopStack } = await import("../../sources/tests/stack");
const { pluginTgz } = await import("../../sources/tests/tarball");
const { startWorker, until } = await import("./worker");
const natsKv = await import("../../../../db/natsKv");
const { triggerKey } = await import("../../../compiler/subjects");
const { applyQueueTrigger, hasQueueTrigger } = await import("../../../triggers/queueRuntime");
const { pluginTriggerRef, setPluginTriggerRefs } = await import(
	"../../../requestRouter/pluginTriggers"
);
const triggersApi = (await import("../../../../api/v1/triggers/register")).default;
const integrationsApi = (await import("../../../../api/v1/integrations/register")).default;

const NAME = "acme/poll";
const KIND = `${NAME}/poller`;
const TYPE = `plugin:${KIND}`;
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
let sql: Awaited<ReturnType<typeof startStack>>["sql"];

beforeAll(async () => {
	({ sql } = await startStack("triggers", [triggersApi as never, integrationsApi as never]));
}, 240_000);
afterAll(stopStack);

const poller = (params: Record<string, unknown> = {}) =>
	trigger({
		name: KIND,
		label: "Poller",
		icon: ICON,
		permissions: { integrations: ["kv"] },
		params: {
			table: param.string({ required: true }),
			every: param.number({ default: 5 }),
			conn: param.integration({ kind: "kv" }),
			password: param.secret(),
			...params,
		} as never,
		retry: true,
		start: async () => async () => {},
	});

// importing marks the module loaded; `start` marks it started. T2 must never start it.
const MODULE = `globalThis.__pollImported = true;
export default { name: "${KIND}", start: async () => { globalThis.__pollStarted = true; return async () => {}; } };`;

const pollTgz = (version: string, entry = toTriggerEntry(poller())) =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/poll",
			version,
			fluxify: { name: NAME, url: "https://github.com/acme/fluxify-poll" },
		}),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify({
			name: NAME,
			url: "https://github.com/acme/fluxify-poll",
			sdk: ">=2026.10.0",
			blocks: {},
			triggers: [{ ...entry, entry: "dist/triggers/poller.js" }],
		}),
		"dist/triggers/poller.js": MODULE,
		"dist/blocks/step.js": null,
	} as never);

type Stack = Awaited<ReturnType<typeof setup>>;

/** an approved plugin, on in development, and a workflow live there */
async function approved() {
	const s = await setup();
	expect((await s.upload(pollTgz("2026.10.2001"))).status).toBe(200);
	expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
	expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
	const workflowId = Bun.randomUUIDv7();
	await sql`INSERT INTO workflows (id, name, project_id) VALUES (${workflowId}, 'wf', ${s.project})`;
	return { ...s, workflowId };
}

async function integration(s: Stack, group: string, variant: string) {
	const id = Bun.randomUUIDv7();
	const name = `${group}-${faker.string.alphanumeric(6)}`;
	await sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
		VALUES (${id}, ${name}, ${group}, ${variant}, '{}'::jsonb, ${s.project})`;
	return { id, name };
}

const create = (s: Stack & { workflowId?: string }, body: Record<string, unknown>) =>
	s.api("POST", "/triggers", {
		name: `t-${faker.string.alphanumeric(8)}`,
		type: TYPE,
		projectId: s.project,
		workflowId: s.workflowId,
		active: true,
		...body,
	});

const fields = (res: { body: { errors?: { field: string }[] } }) =>
	(res.body.errors ?? []).map((e) => e.field).sort();
const artifact = (project: string, id: string, env: "development" | "production") =>
	natsKv.getArtifact<any>(triggerKey(project, id), env);

describe("plugin triggers: create and update", () => {
	it("refuses an unknown kind, a pending plugin, bad params and an ungranted integration, naming each field", async () => {
		const s = await setup();
		expect(fields(await create(s, { type: "plugin:acme/nope/x", source: {} }))).toEqual(["type"]);
		// uploaded, not approved
		expect((await s.upload(pollTgz("2026.10.2001"))).status).toBe(200);
		expect(fields(await create(s, { source: { table: "jobs" } }))).toEqual(["type"]);
		expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
		expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);

		const db = await integration(s, "database", "PostgreSQL");
		const bad = await create(s, {
			integrationId: db.id,
			source: { every: "soon", conn: db.id, password: "PASSWORD" },
		});
		expect(bad.status).toBe(400);
		expect(fields(bad)).toEqual([
			"integrationId",
			"source.conn",
			"source.every",
			"source.password",
			"source.table",
		]);
		expect(fields(await create(s, { source: { table: "jobs", conn: "not-an-id" } }))).toEqual(["source.conn"]);

		const kv = await integration(s, "kv", "Redis");
		const ok = await create(s, { source: { table: "jobs", conn: kv.id, password: "cfg:DB_PASSWORD" } });
		expect(ok.status).toBe(200);
		const got = await s.api("GET", `/triggers/${ok.body.id}`);
		expect(got.body).toMatchObject({ type: TYPE, integrationId: null });
		expect(got.body.source).toEqual({ table: "jobs", conn: kv.id, password: "cfg:DB_PASSWORD" });

		// an update is checked the same way
		const patched = await s.api("PATCH", `/triggers/${ok.body.id}`, { source: { every: 3 } });
		expect(fields(patched)).toEqual(["source.table"]);
	});
});

describe("plugin triggers: artifacts and lifecycle", () => {
	it("publishes where workflow and plugin are live, and withdraws on disable while keeping the row", async () => {
		const s = await approved();
		const plugin = (await s.get(`/${NAME}`)).body;
		// the approval page reads the trigger kinds and what they may reach
		expect(plugin.triggers).toEqual([
			{
				kind: KIND,
				type: TYPE,
				label: "Poller",
				permissions: { integrations: ["kv"] },
				retry: true,
				secretParams: ["password"],
			},
		]);
		expect(plugin.permissions).toEqual({ integrations: ["kv"], appconfig: false });

		const created = await create(s, { source: { table: "jobs" }, maxAttempts: 4 });
		expect(created.status).toBe(200);
		const id = created.body.id as string;
		const row = (await s.api("GET", `/triggers/${id}`)).body;
		expect(await artifact(s.project, id, "development")).toMatchObject({
			triggerId: id,
			projectId: s.project,
			workflowId: s.workflowId,
			groupId: row.groupId,
			type: TYPE,
			integrationId: null,
			source: { table: "jobs" },
			maxAttempts: 4,
			plugin: { kind: KIND, name: NAME, version: "2026.10.2001", integrity: plugin.integrity, retry: true },
		});
		// the workflow is not live in production, nor is the plugin
		expect(await artifact(s.project, id, "production")).toBeNull();

		expect((await s.put(`/${NAME}/environments`, { dev: false, prod: false })).status).toBe(200);
		expect(await artifact(s.project, id, "development")).toBeNull();
		const kept = await s.api("GET", `/triggers/${id}`);
		expect(kept.body).toMatchObject({ active: true, source: { table: "jobs" } });
		const list = await s.api("GET", `/triggers/list?projectId=${s.project}`);
		expect(list.body.data.find((t: any) => t.id === id).pluginDisabled).toBe(true);
		const refused = await create(s, { source: { table: "jobs" } });
		expect(refused.body.errors).toEqual([{ field: "type", message: `plugin ${NAME} is disabled` }]);
		expect((await s.api("GET", `/triggers/plugin-kinds?projectId=${s.project}`)).body.data).toEqual([]);

		expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
		expect(await artifact(s.project, id, "development")).toMatchObject({ triggerId: id });
	});

	it("lists the kinds a project can create, by a namespaced kind as a query param", async () => {
		const s = await approved();
		const one = await s.api("GET", `/triggers/plugin-kinds?projectId=${s.project}&kind=${encodeURIComponent(KIND)}`);
		expect(one.status).toBe(200);
		expect(one.body.data).toEqual([
			expect.objectContaining({
				kind: KIND,
				type: TYPE,
				plugin: NAME,
				retry: true,
				environments: { development: true, production: false },
				params: expect.objectContaining({ table: expect.objectContaining({ type: "string", required: true }) }),
			}),
		]);
		const none = await s.api("GET", `/triggers/plugin-kinds?projectId=${s.project}&kind=acme%2Fpoll%2Fother`);
		expect(none.body.data).toEqual([]);
	});

	it("refuses removal while triggers exist, listing them, and allows it once they are gone", async () => {
		const s = await approved();
		const id = (await create(s, { source: { table: "jobs" } })).body.id as string;
		const name = (await s.api("GET", `/triggers/${id}`)).body.name;
		const refused = await s.api("DELETE", `/plugins/${NAME}?projectId=${s.project}`);
		expect(refused.status).toBe(409);
		expect(refused.body.triggers).toEqual([{ id, name, kind: KIND }]);
		expect((await s.api("DELETE", `/triggers/${id}`)).status).toBe(200);
		expect((await s.api("DELETE", `/plugins/${NAME}?projectId=${s.project}`)).status).toBe(200);
	});

	it("refuses an upgrade that breaks a trigger, and applies one that does not", async () => {
		const s = await approved();
		const id = (await create(s, { source: { table: "jobs" } })).body.id as string;
		const breaking = toTriggerEntry(poller({ schema: param.string({ required: true }) }));
		expect((await s.upload(pollTgz("2026.10.2002", breaking))).status).toBe(200);
		const preview = (await s.get(`/${NAME}/upgrade-preview`)).body;
		expect(preview.diff.changedTriggers).toEqual([
			expect.objectContaining({ kind: KIND, change: "required param schema added", breaking: true }),
		]);
		const refused = await s.post(`/${NAME}/approve`, {});
		expect(refused.status).toBe(409);
		expect(refused.body.message).toContain(`trigger kind ${KIND}: required param schema added`);
		// the approved version keeps serving
		expect((await artifact(s.project, id, "development")).plugin.version).toBe("2026.10.2001");

		const fine = toTriggerEntry(poller({ schema: param.string() }));
		expect((await s.upload(pollTgz("2026.10.2003", fine))).status).toBe(200);
		expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
		expect((await artifact(s.project, id, "development")).plugin.version).toBe("2026.10.2003");
	});

	it("deleting an integration a trigger uses disables it and keeps the row; re-enabling refuses the stale id", async () => {
		const s = await approved();
		const kv = await integration(s, "kv", "Redis");
		const id = (await create(s, { source: { table: "jobs", conn: kv.id } })).body.id as string;
		expect(await artifact(s.project, id, "development")).not.toBeNull();

		expect((await s.api("DELETE", `/${s.project}/integrations/${kv.id}`)).status).toBe(204);
		const off = (await s.api("GET", `/triggers/${id}`)).body;
		expect(off).toMatchObject({
			active: false,
			disabledReason: `integration "${kv.name}" was deleted`,
			source: { table: "jobs", conn: kv.id },
		});
		expect(await artifact(s.project, id, "development")).toBeNull();

		const again = await s.api("PATCH", `/triggers/${id}`, { active: true });
		expect(again.status).toBe(400);
		expect(again.body.errors).toEqual([
			{ field: "source.conn", message: `no integration ${kv.id} in this project` },
		]);
	});
});

describe("plugin triggers: the worker", () => {
	it("holds the trigger's code as a ref and never starts it", async () => {
		const s = await approved();
		const id = (await create(s, { source: { table: "jobs" } })).body.id as string;
		const published = await artifact(s.project, id, "development");
		const worker = await startWorker(s.project, "development");
		try {
			await until(
				() => worker.status(),
				(status) => status[pluginStatusKey(s.project, NAME)]?.state === "ready",
			);
			const refs = worker.installer.triggerRefs();
			expect(refs).toEqual([
				expect.objectContaining({
					projectId: s.project,
					plugin: NAME,
					kind: KIND,
					integrity: published.plugin.integrity,
					permissions: { integrations: ["kv"], appconfig: false },
				}),
			]);
			expect(existsSync(refs[0]!.entry)).toBe(true);
			expect(worker.installer.refs()).toEqual([]);

			// what the execution process does with them: holds the ref, and the queue runtime passes the artifact by
			setPluginTriggerRefs(refs);
			expect(pluginTriggerRef(s.project, published.plugin.kind)?.entry).toBe(refs[0]!.entry);
			await applyQueueTrigger(id, published);
			expect(hasQueueTrigger(id)).toBe(false);
			const g = globalThis as { __pollImported?: boolean; __pollStarted?: boolean };
			expect(g.__pollImported).toBeUndefined();
			expect(g.__pollStarted).toBeUndefined();
		} finally {
			await worker.stop();
		}
	});
});

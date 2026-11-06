// A plugin trigger's Lag per worker (#963) end to end: a real NATS and Postgres
// behind the plugins and triggers API. What a user and an agent do: install a
// plugin whose trigger defines `lag`, create triggers of it with and without a
// value, and edit them. The default fill, the required refusal and the edit rules
// are decided across the API, the plugin store and the row, so a mock of any one
// would only prove what the code says.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { faker } from "@faker-js/faker";
import { param } from "@fluxify/sdk/blocks";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { setup, startStack, stopStack } = await import("../../sources/tests/stack");
const { pluginTgz } = await import("../../sources/tests/tarball");
const natsKv = await import("../../../../db/natsKv");
const { triggerKey } = await import("../../../compiler/subjects");
const triggersApi = (await import("../../../../api/v1/triggers/register")).default;

const NAME = "acme/lagged";
const KIND = `${NAME}/poller`;
const TYPE = `plugin:${KIND}`;
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const HELP = "Pending rows one worker clears per poll";
type Lag = { default?: number; helpText: string };
let sql: Awaited<ReturnType<typeof startStack>>["sql"];

beforeAll(async () => {
	({ sql } = await startStack("triggerlag", [triggersApi as never]));
}, 240_000);
afterAll(stopStack);

const poller = (lag?: Lag) =>
	trigger({
		name: KIND,
		label: "Poller",
		icon: ICON,
		params: { table: param.string({ required: true }) },
		start: async () => async () => {},
		...(lag ? { lag: { read: async () => 0, ...lag } } : {}),
	});

const MODULE = `export default { name: "${KIND}", start: async () => async () => {} };`;
const lagTgz = (lag?: Lag) =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/lagged",
			version: "2026.10.2001",
			fluxify: { name: NAME, url: "https://github.com/acme/fluxify-lagged" },
		}),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify({
			name: NAME,
			url: "https://github.com/acme/fluxify-lagged",
			sdk: ">=2026.10.0",
			blocks: {},
			triggers: [{ ...toTriggerEntry(poller(lag)), entry: "dist/triggers/poller.js" }],
		}),
		"dist/triggers/poller.js": MODULE,
		"dist/blocks/step.js": null,
	} as never);

/** a project with the plugin approved and a workflow live; `lag` is what its trigger defines */
async function project(lag?: Lag) {
	const s = await setup();
	expect((await s.upload(lagTgz(lag))).status).toBe(200);
	expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
	expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
	const workflowId = Bun.randomUUIDv7();
	await sql`INSERT INTO workflows (id, name, project_id) VALUES (${workflowId}, 'wf', ${s.project})`;
	return { ...s, workflowId };
}
type Project = Awaited<ReturnType<typeof project>>;

const create = (s: Project, source: Record<string, unknown>) =>
	s.api("POST", "/triggers", {
		name: `t-${faker.string.alphanumeric(8)}`,
		type: TYPE,
		projectId: s.project,
		workflowId: s.workflowId,
		active: true,
		source,
	});
const sourceOf = async (s: Project, id: string) =>
	(await s.api("GET", `/triggers/${id}`)).body.source as Record<string, unknown>;
const fields = (res: { body: { errors?: { field: string }[] } }) =>
	(res.body.errors ?? []).map((e) => e.field);
const kindsOf = async (s: Project) =>
	(await s.api("GET", `/triggers/plugin-kinds?projectId=${s.project}`)).body.data.find(
		(k: { kind: string }) => k.kind === KIND,
	);

describe("a kind with a default for Lag per worker", () => {
	it("fills the default when none is sent, keeps the user's own, and refuses a value KEDA could not divide by", async () => {
		const s = await project({ default: 50, helpText: HELP });
		const plain = await create(s, { table: "jobs" });
		expect(plain.status).toBe(200);
		expect(await sourceOf(s, plain.body.id)).toEqual({ table: "jobs", lagPerWorker: 50 });

		const own = await create(s, { table: "jobs", lagPerWorker: 7 });
		expect(await sourceOf(s, own.body.id)).toEqual({ table: "jobs", lagPerWorker: 7 });

		for (const bad of [0, -2, 1.5, "ten"]) {
			const refused = await create(s, { table: "jobs", lagPerWorker: bad });
			expect(refused.status).toBe(400);
			expect(fields(refused)).toEqual(["source.lagPerWorker"]);
		}
	});

	it("is stored before the artifact is published, so the workers see that a target exists", async () => {
		const s = await project({ default: 50, helpText: HELP });
		const made = await create(s, { table: "jobs" });
		const artifact = await natsKv.getArtifact<any>(
			triggerKey(s.project, made.body.id),
			"development",
		);
		expect(artifact?.source).toEqual({ table: "jobs", lagPerWorker: 50 });
	});

	it("offers the field to the wizard as a param of its own, in a Scaling tab, with the plugin's help text", async () => {
		const s = await project({ default: 50, helpText: HELP });
		const entry = await kindsOf(s);
		expect(entry.params.lagPerWorker).toEqual({
			type: "number",
			label: "Lag per worker",
			description: HELP,
			min: 1,
			integer: true,
			tab: "Scaling",
			default: 50,
		});
		// the author's own params are untouched
		expect(Object.keys(entry.params)).toEqual(["table", "lagPerWorker"]);
	});
});

describe("a kind with no default", () => {
	it("refuses a new trigger without a value, naming the field, and takes one with a value", async () => {
		const s = await project({ helpText: HELP });
		const refused = await create(s, { table: "jobs" });
		expect(refused.status).toBe(400);
		expect(fields(refused)).toEqual(["source.lagPerWorker"]);
		expect((await create(s, { table: "jobs", lagPerWorker: 25 })).status).toBe(200);
		const entry = await kindsOf(s);
		expect(entry.params.lagPerWorker).toMatchObject({ required: true });
		expect(entry.params.lagPerWorker.default).toBeUndefined();
	});

	it("never refuses an edit of a trigger that has no value, which keeps scaling on cpu and memory", async () => {
		const s = await project({ helpText: HELP });
		const made = await create(s, { table: "jobs", lagPerWorker: 25 });
		const id = made.body.id as string;
		// as saved before the plugin gained `lag`
		await sql`UPDATE triggers SET source = ${JSON.stringify({ table: "jobs" })}::text::jsonb WHERE id = ${id}`;
		const rename = await s.api("PATCH", `/triggers/${id}`, {
			name: `renamed-${faker.string.alphanumeric(6)}`,
		});
		expect(rename.status).toBe(200);
		const edit = await s.api("PATCH", `/triggers/${id}`, { source: { table: "orders" } });
		expect(edit.status).toBe(200);
		expect(await sourceOf(s, id)).toEqual({ table: "orders" });
		// and turning it on is a value, set on purpose
		const on = await s.api("PATCH", `/triggers/${id}`, {
			source: { table: "orders", lagPerWorker: 5 },
		});
		expect(on.status).toBe(200);
	});

	it("refuses an edit that clears a value the trigger had, since there is no default to put back", async () => {
		const s = await project({ helpText: HELP });
		const made = await create(s, { table: "jobs", lagPerWorker: 25 });
		const cleared = await s.api("PATCH", `/triggers/${made.body.id}`, {
			source: { table: "jobs" },
		});
		expect(cleared.status).toBe(400);
		expect(fields(cleared)).toEqual(["source.lagPerWorker"]);
		expect((await sourceOf(s, made.body.id)).lagPerWorker).toBe(25);
	});

	it("leaves the stored value alone when an edit sends no source", async () => {
		const s = await project({ helpText: HELP });
		const made = await create(s, { table: "jobs", lagPerWorker: 25 });
		const renamed = await s.api("PATCH", `/triggers/${made.body.id}`, { description: "d" });
		expect(renamed.status).toBe(200);
		expect((await sourceOf(s, made.body.id)).lagPerWorker).toBe(25);
	});
});

describe("a kind that defines no lag", () => {
	it("adds nothing to the wizard and asks nothing of a trigger", async () => {
		const s = await project();
		expect(Object.keys((await kindsOf(s)).params)).toEqual(["table"]);
		const made = await create(s, { table: "jobs" });
		expect(made.status).toBe(200);
		expect(await sourceOf(s, made.body.id)).toEqual({ table: "jobs" });
	});
});

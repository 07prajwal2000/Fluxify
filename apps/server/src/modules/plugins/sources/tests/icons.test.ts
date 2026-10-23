// Plugin icons (#977) against a real Postgres and NATS Object Store: the
// trigger and integration icons a plugin ships as paths come back from every
// API as data URLs, a row stored with paths is never served with one, and the
// startup backfill fixes it from the stored tarball (or drops the icon).
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { setup, startStack, stopStack } = await import("./stack");
const { pluginTgz } = await import("./tarball");
const triggersApi = (await import("../../../../api/v1/triggers/register")).default;
const integrationsApi = (await import("../../../../api/v1/integrations/register")).default;

const NAME = "acme/icons";
const SVG = "<svg/>";
const DATA = `data:image/svg+xml;base64,${btoa(SVG)}`;
let sql: Awaited<ReturnType<typeof startStack>>["sql"];

beforeAll(async () => {
	({ sql } = await startStack("icons", [triggersApi as never, integrationsApi as never]));
}, 240_000);
afterAll(stopStack);

/** the entries as the CLI writes them: `icon` is a path into the package */
const hub = {
	...toIntegrationEntry({
		name: `${NAME}/hub`,
		label: "Hub",
		icon: "icons/hub.svg",
		group: "notes",
		variant: "Hub",
		config: {},
		connect: () => ({}),
	} as never),
	entry: "dist/integrations/hub.js",
};
const poller = {
	...toTriggerEntry(
		trigger({
			name: `${NAME}/poller`,
			label: "Poller",
			icon: "icons/poller.svg",
			permissions: {},
			params: {},
			retry: false,
			start: async () => async () => {},
		} as never),
	),
	entry: "dist/triggers/poller.js",
};

const manifest = {
	name: NAME,
	url: "https://github.com/acme/fluxify-icons",
	sdk: ">=2026.10.0",
	icon: "icons/plugin.svg",
	blocks: {},
	integrations: [hub],
	triggers: [poller],
};

const tgz = () =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/icons",
			version: "2026.10.2001",
			fluxify: { name: NAME, url: manifest.url },
		}),
		"fluxify.json": JSON.stringify(manifest),
		"icons/plugin.svg": SVG,
		"icons/hub.svg": SVG,
		"icons/poller.svg": SVG,
		"dist/integrations/hub.js": "export default {};",
		"dist/triggers/poller.js": "export default {};",
		"dist/blocks/step.js": null,
	} as never);

/** an approved plugin on in development */
async function approved() {
	const s = await setup();
	expect((await s.upload(tgz())).status).toBe(200);
	expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
	expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
	return s;
}

const kindIcon = async (s: Awaited<ReturnType<typeof setup>>) =>
	(await s.api("GET", `/triggers/plugin-kinds?projectId=${s.project}`)).body.data[0]?.icon;
const variantIcon = async (s: Awaited<ReturnType<typeof setup>>) =>
	(await s.api("GET", `/${s.project}/integrations/variants`)).body
		.find((g: { group: string }) => g.group === "acme/notes")
		?.variants.find((v: { variant: string }) => v.variant === "Hub")?.icon;

describe("an uploaded plugin", () => {
	it("serves its trigger and integration icons as data URLs", async () => {
		const s = await approved();
		expect(await kindIcon(s)).toBe(DATA);
		expect(await variantIcon(s)).toBe(DATA);
		const [row] = await s.rows();
		expect(row.manifest.triggers[0].icon).toBe(DATA);
		expect(row.manifest.integrations[0].icon).toBe(DATA);
	});
});

/** the manifest as a row stored before icons were converted still holds it */
async function withPaths(s: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
	const [row] = await s.rows();
	const paths = structuredClone(row.manifest);
	paths.icon = "icons/plugin.svg";
	paths.integrations[0].icon = "icons/hub.svg";
	paths.triggers[0].icon = "icons/poller.svg";
	await sql`UPDATE plugins SET manifest = ${JSON.stringify(paths)}::text::jsonb WHERE id = ${row.id}`;
	if (Object.keys(over).length) await sql`UPDATE plugins SET ${sql(over)} WHERE id = ${row.id}`;
}

describe("a row stored with icon paths", () => {
	it("is never served with a path: the API drops it", async () => {
		const s = await approved();
		await withPaths(s);
		expect(await kindIcon(s)).toBeUndefined();
		const plugin = (await s.get(`/${NAME}`)).body;
		expect([plugin.manifest.icon, plugin.manifest.triggers[0].icon, plugin.manifest.integrations[0].icon]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		const [listed] = (await s.get("/list")).body;
		expect(listed.manifest.triggers[0].icon).toBeUndefined();
		// the variants endpoint reads the registry; resync it from the row
		const { syncPluginVariants } = await import("../../variants");
		await syncPluginVariants(s.project, NAME);
		expect(await variantIcon(s)).toBeUndefined();
	});

	it("the backfill reads the stored tarball, and a second run changes nothing", async () => {
		const { backfillPluginIcons } = await import("../../iconBackfill");
		const s = await approved();
		await withPaths(s);
		await backfillPluginIcons();
		const [fixed] = await s.rows();
		expect([fixed.manifest.icon, fixed.manifest.integrations[0].icon, fixed.manifest.triggers[0].icon]).toEqual([
			DATA,
			DATA,
			DATA,
		]);
		await backfillPluginIcons();
		const [again] = await s.rows();
		expect(again.manifest).toEqual(fixed.manifest);
		expect(again.updated_at).toEqual(fixed.updated_at);
	});

	it("the backfill drops an icon when the tarball is gone, and the API serves none", async () => {
		const { backfillPluginIcons } = await import("../../iconBackfill");
		const s = await approved();
		await withPaths(s, { location: `${s.project}/acme/icons/gone.tgz` });
		await backfillPluginIcons();
		const [row] = await s.rows();
		expect([row.manifest.icon, row.manifest.integrations[0].icon, row.manifest.triggers[0].icon]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		expect(await kindIcon(s)).toBeUndefined();
	});
});

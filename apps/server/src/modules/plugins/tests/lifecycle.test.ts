// Upgrade and removal of a plugin (#860) against a real Postgres and NATS: the
// approval guard reads real canvases and promoted snapshots, the recompiled
// artifact is what a worker would load, and removal is checked in the bucket,
// the object store and the tables, not in a mock.
import { describe, expect, it } from "bun:test";
import { entry } from "./fixtures";
import { call, natsKv, routeCalling, routeKey, service, setup, sql, version, where } from "./harness";

type Stack = Awaited<ReturnType<typeof setup>>;

/** v1 of the plugin, approved */
async function approved(s: Stack, blocks: ReturnType<typeof entry>[]) {
	const { registerPluginVersion, approvePlugin } = await service();
	await registerPluginVersion(s.project, version(s.name, "sha-1", blocks));
	await approvePlugin(s.project, s.name, s.caller);
}

const upgradeTo = async (s: Stack, blocks: ReturnType<typeof entry>[]) =>
	(await service()).registerPluginVersion(s.project, { ...version(s.name, "sha-2", blocks), version: "2026.10.2002" });

/** the route's working copy, promoted as is */
async function promote(project: string, route: string) {
	const blocks = await sql`SELECT id, key, type, data, position FROM blocks WHERE route_id = ${route}`;
	const edges = await sql`SELECT id, "from", "to", from_handle AS "fromHandle", to_handle AS "toHandle" FROM edges WHERE route_id = ${route}`;
	const snapshot = JSON.stringify({ blocks, edges, settings: {} });
	const [v] = await sql`INSERT INTO canvas_versions (id, kind, route_id, project_id, version_number, title, snapshot)
		VALUES (${crypto.randomUUID()}, 'route', ${route}, ${project}, 1, 'v1', ${snapshot}::text::jsonb) RETURNING id`;
	await sql`UPDATE routes SET prod_version_id = ${v.id} WHERE id = ${route}`;
}

const compiled = async (s: Stack, route: string) => {
	await (await import("../../compiler/project")).compileProject(s.project);
	return natsKv.getArtifact<any>(routeKey(s.project, route), "development");
};

describe("plugin upgrade", () => {
	it("refuses to approve a version that removes a param a route sets, and keeps serving the old one", async () => {
		const s = await setup();
		await approved(s, [entry(s.type, { params: { retries: { type: "number" } } })]);
		const { id } = await routeCalling(s, "success", { retries: 3 });

		const usage = await call(s.as, "GET", s.path("/usage"));
		expect(usage.body).toEqual({
			blocks: [
				expect.objectContaining({
					kind: "route",
					id,
					inWorkingCopy: true,
					nodes: [expect.objectContaining({ type: s.type, params: ["retries"], handles: ["success", "target"], invoke: "sync" })],
				}),
			],
			triggers: [],
			integrations: [],
		});

		await upgradeTo(s, [entry(s.type)]);
		const preview = await call(s.as, "GET", s.path("/upgrade-preview"));
		expect(preview.body).toMatchObject({
			from: { integrity: "sha-1" },
			to: { integrity: "sha-2", version: "2026.10.2002" },
			diff: { blocking: true, removedParams: [{ block: s.type, param: "retries" }] },
		});

		const refused = await call(s.as, "POST", s.path("/approve"), { integrity: "sha-2" });
		expect(refused.status).toBe(409);
		expect(refused.body.message).toContain(`param retries of ${s.type} is removed but set by route`);
		expect(refused.body.diff.blockers).toHaveLength(1);
		expect((await call(s.as, "GET", s.path())).body.approval).toBe("pending");
		expect((await where(s.project, s.name)).development).toMatchObject({ integrity: "sha-1" });
		// the old version still compiles for the route
		expect((await compiled(s, id))?.pluginBlocks).toEqual([s.type]);
	});

	it("approves an upgrade that removes only unused handles, and the recompiled route routes by the new ones", async () => {
		const s = await setup();
		const terminal = { handles: { in: ["target"], out: ["source"], body: [] } };
		await approved(s, [entry(s.type, terminal)]);
		const { id } = await routeCalling(s, null);
		expect((await compiled(s, id)).source).toContain(`, ["source"], `);

		await upgradeTo(s, [entry(s.type)]);
		const preview = (await call(s.as, "GET", s.path("/upgrade-preview"))).body;
		expect(preview.diff).toMatchObject({ blocking: false, removedHandles: [{ handle: "source", usedBy: [] }] });
		expect(preview.diff.changedHandlesOrShape).toHaveLength(1);

		expect((await call(s.as, "POST", s.path("/approve"), { integrity: "sha-2" })).status).toBe(200);
		// a stale artifact would still route by `source`
		const after = await compiled(s, id);
		expect(after.source).toContain(`, ["success","failure"], `);
		expect(after.source).not.toContain(`, ["source"], `);
	});
});

describe("plugin removal", () => {
	it("is refused while a route uses it, with the route listed", async () => {
		const s = await setup();
		await approved(s, [entry(s.type)]);
		const { id } = await routeCalling(s);
		const refused = await call(s.as, "DELETE", s.path());
		expect(refused.status).toBe(409);
		expect(refused.body.references).toEqual([expect.objectContaining({ kind: "route", id, inWorkingCopy: true })]);
		expect((await call(s.as, "GET", s.path())).status).toBe(200);
	});

	it("is refused while a promoted version uses it, though the working copy no longer does", async () => {
		const s = await setup();
		await approved(s, [entry(s.type)]);
		const { id, block } = await routeCalling(s);
		await promote(s.project, id);
		await sql`DELETE FROM blocks WHERE id = ${block}`;

		const refused = await call(s.as, "DELETE", s.path());
		expect(refused.status).toBe(409);
		expect(refused.body.references).toEqual([
			expect.objectContaining({ kind: "route", id, inWorkingCopy: false, inProduction: true }),
		]);
	});

	it("is creator-only, and removes the row, both artifacts, the tarballs and the URL requests", async () => {
		const s = await setup();
		const { registerPluginVersion, setPluginEnvironments } = await service();
		await approved(s, [entry(s.type)]);
		await setPluginEnvironments(s.project, s.name, { dev: true, prod: true }, s.caller);
		await registerPluginVersion(s.project, version(s.name, "sha-3"));
		const { pluginObjects } = await import("../../../db/natsObjects");
		const objects = await pluginObjects();
		const tarballs = [`${s.project}/${s.name}/2026.10.2001.tgz`, `${s.project}/${s.name}/2026.10.2002.tgz`];
		for (const key of tarballs) await objects.put(key, new Uint8Array([1]));
		const other = `${s.project}/${s.name}x/2026.10.2001.tgz`;
		await objects.put(other, new Uint8Array([1]));
		await sql`INSERT INTO plugin_url_requests (id, project_id, url, status, requested_by, plugin_name)
			VALUES (${crypto.randomUUID()}, ${s.project}, 'https://x/p.tgz', 'fetched', ${s.as.user}, ${s.name})`;

		expect((await call({ ...s.as, role: "viewer" }, "DELETE", s.path())).status).toBe(403);
		const removed = await call(s.as, "DELETE", s.path());
		expect(removed).toEqual({ status: 200, body: { name: s.name } });

		expect((await call(s.as, "GET", s.path())).status).toBe(404);
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });
		for (const key of tarballs) expect(await objects.get(key)).toBeNull();
		expect(await objects.get(other)).not.toBeNull();
		expect(await sql`SELECT 1 FROM plugin_url_requests WHERE plugin_name = ${s.name}`).toHaveLength(0);
	});
});

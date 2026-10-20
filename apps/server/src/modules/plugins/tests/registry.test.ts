// The plugin registry (#857) against a real Postgres and a real NATS: the
// migration applies, approval moves through its states, the bucket holds a
// plugin only where it may load, and a route that calls a plugin block
// compiles only once its plugin is approved. Mocks would only prove the calls;
// the bucket proves what a worker would find.
import { describe, expect, it } from "bun:test";
import { entry } from "./fixtures";
import { call, natsKv, recompiles, routeCalling, routeKey, service, setup, sql, version, where } from "./harness";

describe("plugin registry", () => {
	it("applies the migration: the plugins table is there", async () => {
		const [row] = await sql`SELECT to_regclass('public.plugins') AS t`;
		expect(row.t).toBe("plugins");
	});

	it("registers a new plugin as pending and publishes nothing", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		const { plugin, changed } = await registerPluginVersion(s.project, version(s.name, "sha-1"));
		expect(changed).toBe(true);
		expect(plugin).toMatchObject({ approval: "pending", devEnabled: true, prodEnabled: false });
		// nothing used it, nothing to rebuild
		expect(recompiles).not.toContain(s.project);
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });
	});

	it("refuses an invalid manifest, a bad version and a renamed upgrade", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		await expect(
			registerPluginVersion(s.project, { ...version(s.name, "x"), manifest: { name: s.name } }),
		).rejects.toThrow("Invalid fluxify.json");
		await expect(
			registerPluginVersion(s.project, { ...version(s.name, "x"), version: "latest" }),
		).rejects.toThrow("exact version");
		await expect(
			registerPluginVersion(s.project, { ...version("acme/other", "x"), expectedName: s.name }),
		).rejects.toThrow(`This is plugin acme/other, not ${s.name}`);
	});

	it("approval is creator-only and bound to the integrity reviewed", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		expect((await call({ ...s.as, role: "viewer" }, "POST", s.path("/approve"), {})).status).toBe(403);
		expect((await call(s.as, "POST", s.path("/approve"), { integrity: "sha-0" })).status).toBe(409);
		expect((await call(s.as, "GET", s.path())).body.approval).toBe("pending");
	});

	it("publishes an approved plugin only to the environments it is enabled in", async () => {
		const s = await setup();
		const { registerPluginVersion } = await service();
		const asked = [entry(`${s.name}/step`, { permissions: { integrations: ["kv"] } })];
		await registerPluginVersion(s.project, version(s.name, "sha-1", asked));

		const approved = await call(s.as, "POST", s.path("/approve"), { integrity: "sha-1" });
		expect(approved.status).toBe(200);
		expect(approved.body).toMatchObject({
			approval: "approved",
			approvedBy: s.as.user,
			permissions: { integrations: ["kv"], appconfig: false },
		});
		const { development, production } = await where(s.project, s.name);
		expect(production).toBeNull();
		expect(development).toMatchObject({
			name: s.name,
			version: "2026.10.2001",
			integrity: "sha-1",
			approval: "approved",
			permissions: { integrations: ["kv"], appconfig: false },
			blocks: {
				[s.type]: {
					entry: "dist/blocks/step.js",
					meta: { handles: { out: ["success", "failure"] }, invoke: ["sync"] },
				},
			},
		});

		// routing on plugin blocks is baked into emitted code: users recompile
		expect(recompiles.filter((p) => p === s.project)).toHaveLength(1);
		const moved = await call(s.as, "PUT", s.path("/environments"), { dev: false, prod: true });
		expect(recompiles.filter((p) => p === s.project)).toHaveLength(2);
		expect(moved.body).toMatchObject({ devEnabled: false, prodEnabled: true });
		const after = await where(s.project, s.name);
		expect(after.development).toBeNull();
		expect(after.production?.name).toBe(s.name);
	});

	it("same integrity changes nothing; new code goes back to pending while the approved version keeps loading", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		await approvePlugin(s.project, s.name, s.caller);
		expect((await registerPluginVersion(s.project, version(s.name, "sha-1"))).changed).toBe(false);
		expect((await where(s.project, s.name)).development).not.toBeNull();

		// more permissions arrive as new code: new integrity, so pending again
		const more = [entry(`${s.name}/step`, { permissions: { appconfig: true } })];
		const { plugin } = await registerPluginVersion(s.project, version(s.name, "sha-2", more));
		expect(plugin).toMatchObject({ approval: "pending", approvedBy: null, integrity: "sha-2" });
		// #860: dev and prod move together, on approval; until then sha-1 serves
		expect((await where(s.project, s.name)).development).toMatchObject({ integrity: "sha-1" });
		expect(plugin.live).toMatchObject({ integrity: "sha-1" });

		const again = await approvePlugin(s.project, s.name, s.caller, "sha-2");
		expect(again.permissions).toEqual({ integrations: [], appconfig: true });
		expect(again.live).toBeNull();
		expect((await where(s.project, s.name)).development).toMatchObject({ integrity: "sha-2" });
	});

	it("rejects, recording who decided, and unpublishes", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		await approvePlugin(s.project, s.name, s.caller);
		const rejected = await call(s.as, "POST", s.path("/reject"));
		expect(rejected.body).toMatchObject({ approval: "rejected", approvedBy: s.as.user });
		expect(await where(s.project, s.name)).toEqual({ development: null, production: null });
		const listed = await call(s.as, "GET", `/plugins/list?projectId=${s.project}`);
		expect(listed.body.map((p: any) => p.name)).toEqual([s.name]);
	});
});

describe("rejecting a pending upgrade", () => {
	it("cancels the upgrade and keeps the approved version serving", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		await approvePlugin(s.project, s.name, s.caller);
		await registerPluginVersion(s.project, { ...version(s.name, "sha-2"), version: "2026.10.2002" });

		const cancelled = await call(s.as, "POST", s.path("/reject"));
		expect(cancelled.body).toMatchObject({
			approval: "approved",
			integrity: "sha-1",
			version: "2026.10.2001",
			live: null,
		});
		expect((await where(s.project, s.name)).development).toMatchObject({ integrity: "sha-1" });
	});
});

describe("a route calling a plugin block", () => {
	const compile = async (id: string) => (await import("../../compiler/service")).compileRoute(id);
	const compileLog = async (id: string) =>
		(await sql`SELECT message FROM system_logs WHERE resource_id = ${id} AND type = 'compile'`)[0]
			?.message as string | undefined;

	it("saves only handles the manifest declares, and reads the specs back", async () => {
		const s = await setup();
		await (await service()).registerPluginVersion(s.project, version(s.name, "sha-1"));
		const bad = await routeCalling(s, "source");
		expect(bad.saved.status).toBe(400);
		expect(bad.saved.body.message).toContain(`has no "source" handle. Use success, failure`);

		const { id, saved } = await routeCalling(s);
		expect(saved.status).toBe(200);
		const items = (await call(s.as, "GET", `/routes/${id}/canvas-items`)).body;
		expect(items.handleSpecs[s.type].out).toEqual(["success", "failure"]);
	});

	it("fails clearly while pending, and compiles with pluginBlocks once approved", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1"));
		const { id } = await routeCalling(s);

		await compile(id);
		expect(await natsKv.getArtifact(routeKey(s.project, id), "development")).toBeNull();
		expect(await compileLog(id)).toBe(
			`Block ${s.type} cannot run: plugin ${s.name}@2026.10.2001 is waiting for a creator to approve it.`,
		);

		await approvePlugin(s.project, s.name, s.caller);
		await compile(id);
		const built = await natsKv.getArtifact<any>(routeKey(s.project, id), "development");
		expect(built.pluginBlocks).toEqual([s.type]);
		expect(built.source).toContain(`lib.invokeRouted(ctx, "${s.type}"`);
		expect(await compileLog(id)).toBe("Compiled");
	});
});

// An integration param's `variants` (#973) on a plugin block, against a real
// Postgres: a canvas save refuses an integration of another variant, naming
// the block and the variants it takes, and an upgrade that narrows `variants`
// is refused while a route still holds a variant it drops.
import { describe, expect, it } from "bun:test";
import { entry } from "./fixtures";
import { routeCalling, service, setup, sql, version } from "./harness";

const step = (name: string, variants: string[]) =>
	entry(`${name}/step`, {
		permissions: { integrations: ["kv"] },
		params: { store: { type: "integration", kind: "kv", variants } },
	});

async function integration(project: string, variant: string) {
	const id = Bun.randomUUIDv7();
	await sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
		VALUES (${id}, ${`kv-${variant}`}, 'kv', ${variant}, '{}'::jsonb, ${project})`;
	return id;
}

describe("plugin block params: number bounds", () => {
	it("a save refuses a value outside a number param's bounds, naming the block and the param", async () => {
		const s = await setup();
		await (await service()).registerPluginVersion(
			s.project,
			version(s.name, "sha-1", [
				entry(`${s.name}/step`, {
					params: { batch: { type: "number", min: 1, max: 10, integer: true } },
				}),
			]),
		);

		const refused = await routeCalling(s, "success", { batch: 11 });
		expect(refused.saved.status).toBe(400);
		expect(refused.saved.body.errors).toEqual([
			{ field: expect.any(String), message: "Step: batch: must be at most 10, got 11" },
		]);
		expect((await routeCalling(s, "success", { batch: 10 })).saved.status).toBe(200);
	});
});

describe("plugin block params: variants", () => {
	it("a save refuses another variant, naming the block and the variants", async () => {
		const s = await setup();
		await (await service()).registerPluginVersion(
			s.project,
			version(s.name, "sha-1", [step(s.name, ["Redis"])]),
		);
		const memcached = await integration(s.project, "Memcached");
		const redis = await integration(s.project, "Redis");

		const refused = await routeCalling(s, "success", { store: memcached });
		expect(refused.saved.status).toBe(400);
		expect(refused.saved.body.errors).toEqual([
			{
				field: expect.any(String),
				message: 'Step: store: integration "kv-Memcached" is Memcached; this field takes only Redis',
			},
		]);
		expect((await routeCalling(s, "success", { store: redis })).saved.status).toBe(200);
	});

	it("an upgrade narrowing variants is refused while a route holds a dropped one", async () => {
		const s = await setup();
		const { registerPluginVersion, approvePlugin } = await service();
		await registerPluginVersion(s.project, version(s.name, "sha-1", [step(s.name, ["Redis", "Memcached"])]));
		await approvePlugin(s.project, s.name, s.caller);
		const memcached = await integration(s.project, "Memcached");
		expect((await routeCalling(s, "success", { store: memcached })).saved.status).toBe(200);

		await registerPluginVersion(s.project, version(s.name, "sha-2", [step(s.name, ["Redis"])]));
		const { upgradePreview } = await import("../upgrade");
		const { diff } = await upgradePreview(s.project, s.name);
		expect(diff.changedVariants).toEqual([
			expect.objectContaining({ block: s.type, param: "store", change: "param store now takes only Redis" }),
		]);
		expect(diff.changedVariants[0]!.usedBy).toHaveLength(1);
		expect(diff.blocking).toBe(true);
		await expect(approvePlugin(s.project, s.name, s.caller)).rejects.toThrow("now takes only Redis");
	});
});

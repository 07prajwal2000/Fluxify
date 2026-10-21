import { afterEach, describe, expect, it } from "bun:test";
import { integrationRegistry } from "@fluxify/adapters";
import { z } from "zod";
import { closeCtxIntegrations, ctxIntegrationStats, withCtxIntegrations } from "../ctxIntegrations";

const GROUP = "acme/store";
const registered: string[] = [];

function register(def: Record<string, unknown>) {
	const variant = `V${registered.length}`;
	integrationRegistry.register({
		group: GROUP,
		variant,
		label: variant,
		configSchema: z.object({}),
		...def,
	} as never);
	registered.push(variant);
	return variant;
}

afterEach(async () => {
	for (const variant of registered.splice(0)) integrationRegistry.unregister(GROUP, variant);
	await closeCtxIntegrations();
});

const open = (found: Record<string, { group: string; variant: string; config: unknown }>, ctx: object = {}) =>
	withCtxIntegrations(ctx as never, (id) => found[id] as never);

describe("ctx.integrations runtime", () => {
	it("hands the same client to every get with the same poolKey, across blocks", async () => {
		let made = 0;
		const variant = register({
			poolKey: (c: { host: string }) => c.host,
			create: () => ({ n: ++made }),
		});
		const found = {
			a: { group: GROUP, variant, config: { host: "h", noise: 1 } },
			b: { group: GROUP, variant, config: { host: "h", noise: 2 } },
			c: { group: GROUP, variant, config: { host: "other" } },
		};
		const first = open(found);
		const [a, b, c] = await Promise.all(["a", "b", "c"].map((id) => first.ctx.integrations.get(id)));
		first.release();
		expect(a).toBe(b);
		expect(c).not.toBe(a);
		// a block that runs later in the request is another run, and gets the same pooled client
		const second = open(found);
		expect(await second.ctx.integrations.get("a")).toBe(a);
		second.release();
		expect(made).toBe(2);
	});

	it("keys on the whole config when the variant has no poolKey", async () => {
		let made = 0;
		const variant = register({ create: () => ({ n: ++made }) });
		const run = open({
			a: { group: GROUP, variant, config: { x: 1, y: 2 } },
			b: { group: GROUP, variant, config: { y: 2, x: 1 } },
			c: { group: GROUP, variant, config: { x: 2, y: 2 } },
		});
		const [a, b, c] = await Promise.all(["a", "b", "c"].map((id) => run.ctx.integrations.get(id)));
		expect(a).toBe(b);
		expect(c).not.toBe(a);
		run.release();
	});

	it("closes a client with the variant's close when the worker shuts down", async () => {
		const closed: unknown[] = [];
		const variant = register({ create: () => ({ n: 1 }), close: (client: unknown) => void closed.push(client) });
		const run = open({ a: { group: GROUP, variant, config: {} } });
		const client = await run.ctx.integrations.get("a");
		run.release();
		expect(ctxIntegrationStats()).toMatchObject({ active: 1, leases: 0 });
		await closeCtxIntegrations();
		expect(closed).toEqual([client]);
	});

	it("falls back to the client's own disconnect", async () => {
		let disconnected = 0;
		const variant = register({ create: () => ({ disconnect: async () => void disconnected++ }) });
		const run = open({ a: { group: GROUP, variant, config: {} } });
		await run.ctx.integrations.get("a");
		run.release();
		await closeCtxIntegrations();
		expect(disconnected).toBe(1);
	});

	it("routes databases, key-value stores and queues through the request's own factories", async () => {
		const ctx = {
			dbFactory: { getDbAdapter: (id: string) => `db:${id}` },
			kvFactory: { getKvAdapter: (id: string) => `kv:${id}` },
			queueFactory: { getProducer: async (id: string) => `queue:${id}` },
		};
		const run = open(
			{
				d: { group: "database", variant: "PostgreSQL", config: {} },
				k: { group: "kv", variant: "Redis", config: {} },
				q: { group: "queue", variant: "Kafka", config: {} },
			},
			ctx,
		);
		expect(await Promise.all(["d", "k", "q"].map((id) => run.ctx.integrations.get(id)))).toEqual([
			"db:d",
			"kv:k",
			"queue:q",
		]);
		run.release();
		expect(ctxIntegrationStats()).toMatchObject({ active: 0 });
	});

	it("says what a kind lacks when its variant cannot be created", async () => {
		const variant = register({});
		const run = open({ a: { group: GROUP, variant, config: {} } });
		await expect(run.ctx.integrations.get("a")).rejects.toThrow(`${GROUP} integration '${variant}' cannot be created`);
		await expect(
			open({ a: { group: GROUP, variant: "Gone", config: {} } }).ctx.integrations.get("a"),
		).rejects.toThrow("Unknown integration variant");
	});

	it("kind answers undefined for an id the lookup does not know", () => {
		expect(open({}).ctx.integrations.kind("nope")).toBeUndefined();
	});
});

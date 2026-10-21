import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { faker } from "@faker-js/faker";
import { integrationRegistry, KvFactory } from "@fluxify/adapters";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import type { AnyIntegration, IntegrationVariantDef } from "@fluxify/sdk/integrations";
import { grantContext, toStoredConfig, toVariantDef } from "@fluxify/sdk/runtime";
import { RedisClient } from "bun";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType } from "./builderTypes";
import { closeCtxIntegrations, withCtxIntegrations } from "./builtin/ctxIntegrations";
import { registerModuleBlock, unregisterBlock } from "./builtin/customBlock";
import { compileGraph } from "./compiler";

/**
 * A plugin's KV variant (I5) against a real Valkey: the author's
 * `integration()` is built the way `blocks build` builds it, registered through
 * `toVariantDef` (what I6 will do on a worker) and used by a plugin block
 * through `ctx.integrations.get<"kv">`, so the value really lands in the server
 * and the client is opened once, with the password read through `getConfig`.
 */

const IMAGE = "valkey/valkey:8-alpine";
const CONTAINER = "fluxify-plugin-integration-redis-test";
const PROJECT = "proj-plugin-integration";
const TYPE = "acme/demo/cache";
const KV_ID = "plugin-kv";
const PASSWORD = faker.string.alphanumeric(16);
const OUT = join(import.meta.dir, "tests", "fixtures", "dist");

let port: number;
let raw: RedisClient;
let kvFactory: KvFactory;
let variant: IntegrationVariantDef;
let resolved: Record<string, unknown>;
let seen: { connects: number; closes: number };

const removeIfPresent = (name: string) =>
	docker
		.getContainer(name)
		.remove({ force: true })
		.catch(() => {});

/** the fixture bundled as the CLI bundles an integration, then imported from dist/ */
async function buildFixture() {
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, "tests", "fixtures", "bunRedisVariant.ts")],
		outdir: OUT,
		target: "bun",
		format: "esm",
		external: ["@fluxify/sdk", "@fluxify/sdk/*", "zod"],
	});
	if (!built.success) throw new AggregateError(built.logs, "fixture build failed");
	return (await import(join(OUT, "bunRedisVariant.js"))) as {
		default: AnyIntegration;
		seen: typeof seen;
	};
}

beforeAll(async () => {
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);
	({ port } = await startContainerWithRandomPort((p) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Cmd: ["valkey-server", "--requirepass", PASSWORD],
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(p) }] } },
		}),
	));
	// a container that accepts TCP is not a server that answers commands
	raw = new RedisClient(`redis://:${PASSWORD}@127.0.0.1:${port}`);
	for (let attempt = 0; ; attempt++) {
		try {
			await raw.connect();
			await raw.send("PING", []);
			break;
		} catch (error) {
			if (attempt > 60) throw error;
			await Bun.sleep(500);
		}
	}

	const fixture = await buildFixture();
	seen = fixture.seen;
	variant = toVariantDef(fixture.default);
	integrationRegistry.register(variant);
	// what the integrations loader caches for the row: resolved, variant and group set
	const stored = toStoredConfig(fixture.default, {
		host: "127.0.0.1",
		port,
		password: "REDIS_PASSWORD",
	});
	resolved = {
		...variant.resolve!(stored, { REDIS_PASSWORD: PASSWORD, UNRELATED: "x" }),
		variant: variant.variant,
		group: "kv",
	};
	kvFactory = new KvFactory({ [KV_ID]: resolved as never });
}, 180_000);

afterAll(async () => {
	unregisterBlock(PROJECT, TYPE);
	await KvFactory.ResetConnections().catch(() => {});
	await closeCtxIntegrations();
	integrationRegistry.unregister(variant.group, variant.variant);
	raw?.close();
	await removeIfPresent(CONTAINER);
	rmSync(OUT, { recursive: true, force: true });
});

const block = (id: string, type: string, data: object = {}): BlockDTOType => ({
	id,
	type: type as BlockTypes,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `edge-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});
const META = { handles: { in: ["target"], out: ["source"], body: [] } } as never;

/** entry -> a plugin block granted `kv` -> response, as the plugin loader wraps it */
function graph(run: (kv: Awaited<ReturnType<typeof getKv>>) => Promise<unknown>) {
	registerModuleBlock(
		PROJECT,
		TYPE,
		async (args) => {
			const open = withCtxIntegrations(args.ctx, (id) =>
				id === KV_ID ? { group: "kv", variant: variant.variant, config: resolved } : undefined,
			);
			try {
				const ctx = grantContext(open.ctx, { integrations: ["kv"], appconfig: false }, `block ${TYPE}`);
				return { output: await run(await getKv(ctx)) };
			} finally {
				open.release();
			}
		},
		META,
	);
	return compileGraph(
		[block("in", BlockTypes.entrypoint), block("p", TYPE), block("out", BlockTypes.response, { httpCode: "200" })],
		[edge("in", "p"), edge("p", "out")],
		{ projectId: PROJECT, blockMeta: { [TYPE]: META } },
	).run;
}
const getKv = (ctx: { integrations?: { get<K>(id: string): Promise<any> } }) =>
	ctx.integrations!.get<"kv">(KV_ID);

const request = (run: ReturnType<typeof graph>) =>
	run(
		{
			route: "/x",
			apiId: "a",
			projectId: PROJECT,
			vars: {},
			kvFactory,
			stopper: { timeoutEnd: 0, duration: 30_000 },
		} as never,
		{},
	);

describe("a plugin's KV variant over a real Valkey", () => {
	it("writes through ctx.integrations.get<'kv'>, and the server holds the value", async () => {
		const key = `pi:${faker.string.alphanumeric(8)}`;
		const value = faker.string.alphanumeric(12);
		const run = graph(async (kv) => {
			await kv.set(key, value);
			return kv.get(key);
		});
		expect((await request(run)).output.body).toBe(value);
		expect(await raw.get(key)).toBe(value);
	}, 30_000);

	it("opens one client across requests, password read through getConfig", async () => {
		const run = graph(async (kv) => kv.get("absent"));
		for (let i = 0; i < 3; i++) expect((await request(run)).output.body).toBeNull();
		expect(seen.connects).toBe(1);
	}, 30_000);

	it("expires a setex value and deletes a key on the server", async () => {
		const ttl = `pi:${faker.string.alphanumeric(8)}`;
		const gone = `pi:${faker.string.alphanumeric(8)}`;
		await raw.set(gone, "x");
		await request(
			graph(async (kv) => {
				await kv.setex(ttl, 1, "short");
				await kv.delete(gone);
				return null;
			}),
		);
		expect(await raw.get(ttl)).toBe("short");
		expect(await raw.get(gone)).toBeNull();
		await Bun.sleep(1500);
		expect(await raw.get(ttl)).toBeNull();
	}, 30_000);

	it("Test connection runs the hook on a fresh client and closes it", async () => {
		const closes = seen.closes;
		const result = await variant.test!(
			{ host: "127.0.0.1", port, password: "cfg:REDIS_PASSWORD" },
			{ appConfig: new Map([["REDIS_PASSWORD", PASSWORD]]), options: {} },
		);
		expect(result).toEqual({ success: true });
		expect(seen.closes).toBe(closes + 1);
		const wrong = await variant.test!(
			{ host: "127.0.0.1", port, password: "cfg:REDIS_PASSWORD" },
			{ appConfig: new Map([["REDIS_PASSWORD", "nope"]]), options: {} },
		);
		expect(wrong.success).toBe(false);
		expect(wrong.error).not.toContain("nope");
	}, 30_000);

	it("closes the client once when the factory resets", async () => {
		const closes = seen.closes;
		await KvFactory.ResetConnections();
		await KvFactory.ResetConnections();
		expect(seen.closes).toBe(closes + 1);
	}, 30_000);
});

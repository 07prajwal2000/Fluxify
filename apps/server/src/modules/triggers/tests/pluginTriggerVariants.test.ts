// A Redis-streams plugin trigger (#973) against a real Redis: its param takes
// only the Redis variant, `ctx.integrations.connection` hands it the worker's
// own ioredis client as `raw`, and it reads with XREADGROUP, emits each entry
// to the workflow and XACKs it once `emit` resolved.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";
import type Docker from "dockerode";
import { Redis } from "ioredis";
import { hydrateIntegrations } from "../../../loaders/integrationsLoader";
import { applyPluginTrigger, shutdownPluginTriggers } from "../pluginTriggerRuntime";
import { artifact, fastLimits, install, PROJECT, resetLimits, uninstallAll, until, workflow } from "./pluginTriggerHarness";

const IMAGE = "redis:7-alpine";
const NAME = "fluxify-plugin-trigger-variants-test";
const ID = "019a0000-0000-7000-8000-0000000097a3";
const STREAM = `jobs-${crypto.randomUUID().slice(0, 8)}`;
const g = globalThis as { ptvRuns?: any[]; ptvSeen?: { variant: string; raw: boolean } };

let container: Docker.Container;
let redis: Redis;

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] } },
		}),
	);
	container = started.container;
	redis = new Redis({ host: "127.0.0.1", port: started.port, maxRetriesPerRequest: 1 });
	for (let i = 0; ; i++) {
		try {
			await redis.ping();
			break;
		} catch (error) {
			if (i >= 40) throw error;
			await Bun.sleep(250);
		}
	}
	// the worker's own config for the integration, as a config artifact delivers it
	hydrateIntegrations(PROJECT, {
		kv: { [ID]: { group: "kv", variant: "Redis", source: "credentials", host: "127.0.0.1", port: started.port } },
	});
	fastLimits();
}, 180_000);

afterAll(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
	resetLimits();
	redis?.disconnect();
	await container?.remove({ force: true }).catch(() => {});
});

const streams = trigger({
	name: "acme/streams/read",
	label: "Streams",
	icon: "./s.svg",
	permissions: { integrations: ["kv"] },
	params: { store: param.integration({ kind: "kv", variants: ["Redis"], required: true }) },
	async start(ctx) {
		const conn = await ctx.integrations.connection(ctx.params.store);
		g.ptvSeen = { variant: conn.variant, raw: conn.raw === (await ctx.integrations.get<"kv">(ctx.params.store)).getConnection?.() };
		const client = conn.raw;
		await client.xgroup("CREATE", STREAM, "fx", "0", "MKSTREAM").catch(() => {});
		const loop = (async () => {
			while (!ctx.signal.aborted) {
				// a short block, so a stop is not held up behind it
				const read = (await client.xreadgroup("GROUP", "fx", "c1", "COUNT", 10, "BLOCK", 100, "STREAMS", STREAM, ">")) as
					| [string, [string, string[]][]][]
					| null;
				for (const [, entries] of read ?? [])
					for (const [id, fields] of entries) {
						await ctx.emit([{ id, fields }]);
						await client.xack(STREAM, "fx", id);
					}
			}
		})().catch((error) => ctx.fail(error));
		return async () => void (await loop);
	},
});

describe("a plugin trigger with variants: ['Redis']", () => {
	it("gets the Redis variant and its ioredis client, reads the stream, emits and acks", async () => {
		g.ptvRuns = [];
		workflow("(globalThis.ptvRuns ??= []).push(ctx.vars.trigger.data); return { successful: true };");
		install(streams, { integrations: ["kv"], appconfig: false });
		await applyPluginTrigger("t1", artifact("t1", streams.name, { source: { store: ID } }));
		await until(() => g.ptvSeen, Boolean, "the trigger to start");
		// the same pooled client the kv factory holds, not a second connection
		expect(g.ptvSeen).toEqual({ variant: "Redis", raw: true });

		const id = await redis.xadd(STREAM, "*", "job", "send-email");
		await until(() => g.ptvRuns!.length, (n) => n > 0, "the workflow to run");
		expect(g.ptvRuns![0]).toEqual([expect.objectContaining({ data: { id, fields: ["job", "send-email"] } })]);
		// acked after `emit` resolved: nothing left pending for the group
		const pending = async () => ((await redis.xpending(STREAM, "fx")) as [number])[0];
		for (let i = 0; i < 100 && (await pending()) > 0; i++) await Bun.sleep(20);
		expect(await pending()).toBe(0);
	});
});

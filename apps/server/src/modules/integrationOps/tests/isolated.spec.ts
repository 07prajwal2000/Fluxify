import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOpInChild } from "../isolated";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const root = await mkdtemp(join(tmpdir(), "fluxify-isolated-op-"));
afterAll(() => rm(root, { recursive: true, force: true }));

// a plugin variant as the CLI builds it: what `connect` sees is what the test reports back
const entry = join(root, "hub.js");
await writeFile(
	entry,
	`export default {
		name: "acme/crm/hub", label: "Hub", icon: "x", group: "crm", variant: "Hub",
		config: { token: { type: "secret", required: true }, mode: { type: "string" } },
		connect: (config, ctx) => ({
			token: ctx.getConfig(config.token),
			masterKey: process.env.MASTER_ENCRYPTION_KEY ?? "absent",
			other: (() => { try { return ctx.getConfig("OTHER"); } catch (e) { return e.message; } })(),
		}),
		test: (client, config) => {
			if (config.mode === "hang") return new Promise(() => {});
			return { success: true, warning: JSON.stringify(client) };
		},
	};`,
);

const ref = {
	projectId: "p1",
	plugin: "acme/crm",
	version: "1.0.0+aa",
	group: "acme/crm",
	variant: "Hub",
	entry,
};

describe("runOpInChild", () => {
	it("runs the hook in a fresh process without the master key, with only its own secret", async () => {
		const result = (await runOpInChild({
			ref,
			op: "test",
			call: { group: "acme/crm", variant: "Hub", config: { token: "cfg:TOKEN" } },
			appConfig: [["TOKEN", "s3cret"]],
			timeoutMs: 5_000,
		})) as { success: boolean; warning: string };
		expect(result.success).toBe(true);
		const seen = JSON.parse(result.warning);
		expect(seen.token).toBe("s3cret");
		expect(seen.masterKey).toBe("absent");
		expect(seen.other).toContain("getConfig('OTHER') is not allowed");
	}, 30_000);

	it("validates the stored config as the admin does", async () => {
		await expect(
			runOpInChild({
				ref,
				op: "test",
				call: { group: "acme/crm", variant: "Hub", config: { token: "plain" } },
				appConfig: [],
				timeoutMs: 5_000,
			}),
		).rejects.toThrow("Invalid configuration");
	}, 30_000);

	it("a hook that never answers is cut off by its timeout", async () => {
		await expect(
			runOpInChild({
				ref,
				op: "test",
				call: { group: "acme/crm", variant: "Hub", config: { token: "cfg:TOKEN", mode: "hang" } },
				appConfig: [["TOKEN", "s"]],
				timeoutMs: 300,
			}),
		).rejects.toThrow("Connection timed out after 0.3 seconds");
	}, 30_000);

	it("a module that is missing fails with the plugin's name, not a stack", async () => {
		await expect(
			runOpInChild({
				ref: { ...ref, entry: join(root, "missing.js") },
				op: "test",
				call: { group: "acme/crm", variant: "Hub", config: { token: "cfg:T" } },
				appConfig: [],
				timeoutMs: 5_000,
			}),
		).rejects.toThrow("plugin acme/crm@1.0.0+aa integration acme/crm/Hub failed to load");
	}, 30_000);
});

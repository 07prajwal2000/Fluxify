import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { ModuleBlockRun } from "@fluxify/blocks";
import { pluginBlockRefs } from "../pluginLoader";
import { NO_PERMISSIONS, withGrantedContext } from "../pluginPermissions";

const LABEL = "plugin acme/echo@1.0.0 block acme/echo/step";
const ctx = () =>
	({
		projectId: "p",
		vars: { getConfig: (key: string) => `value of ${key}` },
		dbFactory: { getDbAdapter: () => "db adapter" },
		kvFactory: { getKvAdapter: () => "kv adapter" },
		queueFactory: { getProducer: async () => "producer" },
		integrationFactory: { create: () => "logger" },
	}) as any;

/** a block that reaches for whatever `use` names */
const reach =
	(use: (ctx: any) => unknown): ModuleBlockRun =>
	async ({ ctx }) => ({ output: await use(ctx) });
const call = (run: ModuleBlockRun, granted = NO_PERMISSIONS) =>
	withGrantedContext(run, granted, LABEL)({ params: {}, ctx: ctx() });

describe("a plugin block's ctx (#857)", () => {
	it("refuses an integration kind it was not granted, naming the block", async () => {
		await expect(call(reach((c) => c.kvFactory.getKvAdapter("kv-1")))).rejects.toThrow(
			`${LABEL} was not granted kv integrations; approve a version that asks for it`,
		);
		await expect(call(reach((c) => c.dbFactory.getDbAdapter("db-1")))).rejects.toThrow(
			"was not granted database integrations",
		);
		await expect(call(reach((c) => c.queueFactory.getProducer("q-1")))).rejects.toThrow(
			"was not granted queue integrations",
		);
	});

	it("reaches the kinds it was granted, and only those", async () => {
		const granted = { integrations: ["kv"], appconfig: false };
		expect(await call(reach((c) => c.kvFactory.getKvAdapter("kv-1")), granted)).toEqual({
			output: "kv adapter",
		});
		await expect(call(reach((c) => c.dbFactory.getDbAdapter("db-1")), granted)).rejects.toThrow(
			"database integrations",
		);
	});

	it("reads app config only when granted", async () => {
		const read = reach((c) => c.vars.getConfig("API_KEY"));
		await expect(call(read)).rejects.toThrow(`${LABEL} was not granted app config`);
		expect(await call(read, { integrations: [], appconfig: true })).toEqual({
			output: "value of API_KEY",
		});
	});

	it("never hands over the runtime's observability loggers", async () => {
		expect(await call(reach((c) => c.integrationFactory))).toEqual({ output: undefined });
	});
});

describe("pluginBlockRefs", () => {
	it("is the published plugin plus the install root", () => {
		const meta = { handles: { in: ["target"], out: ["source"], body: [] }, invoke: ["sync"] };
		const permissions = { integrations: ["kv"], appconfig: false };
		const refs = pluginBlockRefs(
			{
				projectId: "p",
				name: "acme/echo",
				version: "1.0.0",
				integrity: "sha256-a",
				source: "upload",
				location: "plugins/p/acme/echo.tgz",
				approval: "approved",
				permissions,
				blocks: { "acme/echo/step": { entry: "dist/blocks/step.js", meta: meta as any } },
				publishedAt: "",
			},
			"/deps/p/plugins/acme/echo/1.0.0",
		);
		expect(refs).toEqual([
			{
				projectId: "p",
				type: "acme/echo/step",
				plugin: "acme/echo",
				version: "1.0.0",
				entry: join("/deps/p/plugins/acme/echo/1.0.0", "dist/blocks/step.js"),
				meta: meta as any,
				permissions,
			},
		]);
	});
});

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BlockDTOType, BlockTypes, compileGraph, hasCustomBlock } from "@fluxify/blocks";
import { pluginDir } from "../../packages/depsDir";
import { initCompiledRuntime, shutdownCompiledRuntime } from "../compiledRuntime";
import { runBlocks } from "../executor";
import {
	loadPluginBlocks,
	type PluginBlockRef,
	setPluginRefs,
	usePluginBlocks,
} from "../pluginLoader";

const root = mkdtempSync(join(tmpdir(), "fluxify-plugins-"));
const P = "proj-plugin-loader";
const imports = ((globalThis as any).__pluginImports ??= {}) as Record<string, number>;

/** a fake built block: counts its imports, answers `<version>:<text>` */
function plugin(version: string, file: string, body?: string) {
	const entry = join(pluginDir(P, "acme/echo", version, root), "dist", "blocks", file);
	mkdirSync(join(entry, ".."), { recursive: true });
	writeFileSync(
		entry,
		`globalThis.__pluginImports[${JSON.stringify(entry)}] = (globalThis.__pluginImports[${JSON.stringify(entry)}] ?? 0) + 1;
${body ?? `export default { run: ({ params }) => ({ output: "${version}:" + params.text }) };`}`,
	);
	return entry;
}

const ref = (type: string, entry: string, meta = {}): PluginBlockRef => ({
	projectId: P,
	type,
	plugin: "acme/echo",
	version: entry.includes("2.0.0") ? "2.0.0" : "1.0.0",
	entry,
	meta,
});

const say = plugin("1.0.0", "say.js");
const shout = plugin("1.0.0", "shout.js");
const sayV2 = plugin("2.0.0", "say.js");
const noRun = plugin("1.0.0", "norun.js", "export default { notRun: true };");
const missing = join(root, "nowhere.js");

setPluginRefs([
	ref("acme/echo/say", say),
	ref("acme/echo/shout", shout),
	ref("acme/echo/norun", noRun),
	ref("acme/echo/missing", missing),
	ref("acme/echo/badmeta", plugin("1.0.0", "badmeta.js"), { handles: { out: ["a", "b", "c"] } }),
]);

afterAll(async () => {
	await shutdownCompiledRuntime();
	rmSync(root, { recursive: true, force: true });
});

describe("plugin loader", () => {
	it("imports only the blocks an artifact calls, once under concurrency", async () => {
		const first = loadPluginBlocks(P, ["acme/echo/say"]);
		const second = loadPluginBlocks(P, ["acme/echo/say"]);
		await Promise.all([first, second]);
		expect(imports[say]).toBe(1);
		expect(imports[shout]).toBeUndefined();
		expect(hasCustomBlock(P, "acme/echo/say")).toBe(true);
		expect(hasCustomBlock(P, "acme/echo/shout")).toBe(false);
		// loaded: nothing to wait for
		await expect(loadPluginBlocks(P, ["acme/echo/say"])).toBeUndefined();
	});

	it("fails a bad path or a module without run, naming plugin, version and type", async () => {
		await expect(loadPluginBlocks(P, ["acme/echo/missing"])).rejects.toThrow(
			"plugin acme/echo@1.0.0 block acme/echo/missing failed to load",
		);
		await expect(loadPluginBlocks(P, ["acme/echo/norun"])).rejects.toThrow(
			/acme\/echo@1\.0\.0 block acme\/echo\/norun .*no run function/,
		);
		await expect(loadPluginBlocks(P, ["acme/echo/unknown"])).rejects.toThrow(
			"no plugin installed provides block acme/echo/unknown",
		);
		await loadPluginBlocks(P, ["acme/echo/shout"]);
		expect(hasCustomBlock(P, "acme/echo/shout")).toBe(true);
	});

	it("validates the manifest's handles on load", async () => {
		await expect(loadPluginBlocks(P, ["acme/echo/badmeta"])).rejects.toThrow(
			"block acme/echo/badmeta failed to load",
		);
		expect(hasCustomBlock(P, "acme/echo/badmeta")).toBe(false);
	});

	it("refuses a second version in the same process", async () => {
		setPluginRefs([ref("acme/echo/say", sayV2)]);
		try {
			await expect(loadPluginBlocks(P, ["acme/echo/say"])).rejects.toThrow("version 1.0.0 is loaded");
			expect(imports[sayV2]).toBeUndefined();
		} finally {
			setPluginRefs([ref("acme/echo/say", say), ref("acme/echo/shout", shout)]);
		}
	});

	it("unregisters a block once its last user leaves", () => {
		usePluginBlocks("route.a", P, ["acme/echo/shout"]);
		usePluginBlocks("route.b", P, ["acme/echo/shout"]);
		usePluginBlocks("route.a", P);
		expect(hasCustomBlock(P, "acme/echo/shout")).toBe(true);
		usePluginBlocks("route.b", P);
		expect(hasCustomBlock(P, "acme/echo/shout")).toBe(false);
	});
});

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});

describe("a route calling a plugin block", () => {
	const compiled = compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("echo", "acme/echo/say", { text: "hi" }),
			block("res", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("entry", "echo"), edge("echo", "res")],
		{ projectId: P, blockMeta: { "acme/echo/say": {} } },
	);
	const route = (routeId: string, pluginBlocks: string[]) => ({
		key: `route.${P}.${routeId}`,
		value: {
			routeId,
			projectId: P,
			projectName: P,
			method: "GET",
			path: `/${routeId}`,
			timeoutSeconds: 30,
			acceptedContentTypes: [],
			tracingEnabled: false,
			recordExecution: false,
			routeVersion: "",
			compiledAt: "",
			source: compiled.source,
			pluginBlocks,
		},
	});
	const call = (routeId: string) =>
		runBlocks({ projectId: P, routeId, projectName: P }, {
			route: `/${routeId}`,
			projectId: P,
			apiId: "api-1",
			vars: {},
			requestBody: null,
			stopper: { timeoutEnd: 0, duration: 10_000 },
		} as any);

	it("imports the block before the runtime is ready, then runs its code", async () => {
		expect(compiled.pluginBlocks).toEqual(["acme/echo/say"]);
		await initCompiledRuntime([
			route("r1", compiled.pluginBlocks),
			route("r2", ["acme/echo/unknown"]),
		]);
		expect((await call("r1"))?.output.body).toBe("1.0.0:hi");
	});

	it("leaves out only the route whose plugin block failed", async () => {
		await expect(call("r2")).rejects.toThrow("No compiled graph for route r2");
	});
});

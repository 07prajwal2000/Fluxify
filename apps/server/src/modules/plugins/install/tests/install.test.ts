// Plugin install on workers (#859) against a real NATS (object store, KV, node
// heartbeats) and Postgres behind the registry API, a real `bun install` for a
// plugin's dependency, and a real supervisor with a child process. A mock would
// prove what the installer asks for; these prove what a worker ends up running.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileGraph } from "@fluxify/blocks";
import { pluginStatusKey } from "@fluxify/common/orchestrator";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { pluginObjects } from "../../../../db/natsObjects";
import { initCompiledRuntime, shutdownCompiledRuntime } from "../../../requestRouter/compiledRuntime";
import { runBlocks } from "../../../requestRouter/executor";
import { createExecutionSupervisor } from "../../../requestRouter/executionSupervisor";
import { type PluginBlockRef, setPluginRefs } from "../../../requestRouter/pluginLoader";
import { pluginDir } from "../../../packages/depsDir";
import { pluginInstallStatus } from "../../installStatus";
import { blockMetaOf } from "../../meta";
import { keyOf, setup, startStack, stopStack } from "../../sources/tests/stack";
import { pluginFiles, pluginTgz } from "../../sources/tests/tarball";
import { entry, graphCalling, manifest } from "../../tests/fixtures";
import { startWorker, until } from "./worker";

let sql: Awaited<ReturnType<typeof startStack>>["sql"];
beforeAll(async () => {
	sql = (await startStack("install")).sql;
}, 240_000);
afterAll(async () => {
	await shutdownCompiledRuntime();
	await stopStack();
});

const NAME = "acme/echo";
const TYPE = `${NAME}/step`;
const URL_ = "https://github.com/acme/fluxify-echo";

/** the compiler names the handle an edge leaves by in `toHandle` */
const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});

/** `bun install` for a package with these dependencies, to get the lockfile a plugin author commits */
async function lockFor(name: string, dependencies: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "fx-plugin-lock-"));
	try {
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@${name}`, version: "1.0.0", dependencies }));
		const child = Bun.spawn([process.execPath, "install"], {
			cwd: dir,
			env: { ...process.env, BUN_BE_BUN: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await child.exited).toBe(0);
		return readFileSync(join(dir, "bun.lock"), "utf8");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

type Spec = {
	name?: string;
	version: string;
	tag: string;
	lock?: string;
	useMs?: boolean;
	/** a real `block()` using the worker's @fluxify/sdk and zod, as peers and with no lockfile */
	sdk?: boolean;
};

/** `block()` from `@fluxify/sdk/blocks`, validating with zod; it re-exports `block` so a test can compare instances */
const sdkBlock = (type: string, tag: string) => `import { block, handle } from "@fluxify/sdk/blocks";
import { z } from "zod";
export { block };
export default block({
	name: "${type}",
	label: "Step",
	invoke: ["sync"],
	handles: { out: [handle.out("success"), handle.out("failure")] },
	run: () => ({ output: z.string().parse("${tag}"), handle: "success" }),
});`;

/** the files of a built plugin whose one block answers `tag` (with `ms` when `useMs`, a real dependency) */
function files({ name = NAME, version, tag, lock, useMs, sdk }: Spec) {
	const peers = { "@fluxify/sdk": ">=2026.10.2001", zod: "^4.0.0" };
	return {
		"package.json": JSON.stringify({
			name: `@${name}`,
			version,
			...(useMs ? { dependencies: { ms: "2.1.3" } } : {}),
			...(sdk ? { peerDependencies: peers } : {}),
			fluxify: { name, url: URL_ },
		}),
		"fluxify.json": JSON.stringify(manifest(name, [entry(`${name}/step`)])),
		"bun.lock": sdk ? null : (lock ?? "{}"),
		"dist/blocks/step.js": sdk
			? sdkBlock(`${name}/step`, tag)
			: useMs
				? `import ms from "ms"; export default { run: () => ({ output: ms(60000) + ":${tag}", handle: "success" }) };`
				: `export default { run: () => ({ output: "${tag}", handle: "success" }) };`,
	};
}
const tgz = (spec: Spec) => pluginTgz(files(spec));

const STALE_LOCK = JSON.stringify({
	lockfileVersion: 1,
	workspaces: { "": { name: "@acme/broken", dependencies: { ms: "2.0.0" } } },
	packages: { ms: ["ms@2.0.0", "", {}, "sha512-x"] },
});

/** a project with these plugins uploaded, approved and enabled in `envs` */
async function projectWith(specs: Spec[], envs = { dev: true, prod: false }) {
	const s = await setup();
	for (const spec of specs) {
		expect((await s.upload(tgz(spec))).status).toBe(200);
		const name = spec.name ?? NAME;
		expect((await s.post(`/${name}/approve`, {})).status).toBe(200);
		expect((await s.put(`/${name}/environments`, envs)).status).toBe(200);
	}
	return s;
}

const ready = (status: Record<string, { state: string }>, project: string, name = NAME) =>
	status[pluginStatusKey(project, name)]?.state === "ready";

/** the way a user wires it: a graph calling the block, compiled and run; resolves to the response body */
async function runRoute(project: string, refs: PluginBlockRef[]) {
	const meta = blockMetaOf(fluxifyManifestSchema.parse(manifest(NAME)).blocks[TYPE]!);
	const { blocks } = graphCalling(TYPE);
	const compiled = compileGraph(blocks, [edge("1", "2"), edge("2", "3", "success")], {
		projectId: project,
		blockMeta: { [TYPE]: meta },
	});
	setPluginRefs(refs);
	await initCompiledRuntime([
		{
			key: `route.${project}.r1`,
			value: {
				routeId: "r1",
				projectId: project,
				projectName: "p",
				method: "GET",
				path: "/r1",
				timeoutSeconds: 30,
				acceptedContentTypes: [],
				tracingEnabled: false,
				recordExecution: false,
				routeVersion: "",
				compiledAt: "",
				source: compiled.source,
				pluginBlocks: compiled.pluginBlocks,
			},
		},
	]);
	const run = await runBlocks(
		{ projectId: project, routeId: "r1", projectName: "p" },
		{
			route: "/r1",
			projectId: project,
			apiId: "api-1",
			vars: {},
			requestBody: null,
			stopper: { timeoutEnd: 0, duration: 10_000 },
		} as never,
	);
	return run?.output.body;
}

describe("install and run", () => {
	it("a plugin with only peers installs with no bun install and runs on the worker's own SDK and zod", async () => {
		const s = await projectWith([{ version: "2026.10.2001", tag: "peer", sdk: true }]);
		const worker = await startWorker(s.project, "development");
		try {
			await until(worker.status, () => ready(worker.status(), s.project));
			const [ref] = worker.installer.refs();
			const dir = join(dirname(ref!.entry), "..", "..");
			// nothing installed: no lockfile shipped, no node_modules made
			expect(existsSync(join(dir, "bun.lock"))).toBe(false);
			expect(existsSync(join(dir, "node_modules"))).toBe(false);

			expect(await runRoute(s.project, worker.installer.refs())).toBe("peer");
			// the plugin's block() is the runtime's own, not a copy
			const loaded = await import(ref!.entry);
			expect(loaded.block).toBe((await import("@fluxify/sdk/blocks")).block);
		} finally {
			await worker.stop();
		}
	}, 240_000);


	it("an approved upload installs on a production worker, with its dependency, and a route runs its block", async () => {
		const lock = await lockFor(NAME, { ms: "2.1.3" });
		const s = await projectWith([{ version: "2026.10.2001", tag: "one", lock, useMs: true }], {
			dev: true,
			prod: true,
		});
		const worker = await startWorker(s.project, "production");
		try {
			const state = await until(worker.status, () => ready(worker.status(), s.project));
			expect(state[pluginStatusKey(s.project, NAME)]).toMatchObject({
				version: "2026.10.2001",
				state: "ready",
			});

			const [ref] = worker.installer.refs();
			expect(ref!.entry).toStartWith(pluginDir(s.project, NAME, "2026.10.2001", worker.root));
			// the dependency came from the plugin's own lockfile, into the plugin's own directory
			expect(existsSync(join(dirname(ref!.entry), "..", "..", "node_modules", "ms"))).toBe(true);

			expect(await runRoute(s.project, worker.installer.refs())).toBe("1m:one");

			// the admin reads the same state from the node's heartbeat
			const admin = await pluginInstallStatus(s.project, NAME);
			expect(admin).toMatchObject({ version: "2026.10.2001", done: true, failed: false });
			expect(admin.nodes).toEqual([
				expect.objectContaining({ nodeId: worker.nodeId, env: "production" }),
			]);
			expect(admin.nodes[0]!.status).toMatchObject({ state: "ready" });
			expect((await s.get(`/${NAME}`)).body).toMatchObject({ status: "ok", lastError: null });
		} finally {
			await worker.stop();
		}
	}, 240_000);
});

describe("integrity", () => {
	it("a tampered object never loads, the admin hears which node refused it, and recovery clears it", async () => {
		const s = await projectWith([{ version: "2026.10.2001", tag: "one" }]);
		const key = keyOf(s.project);
		const objects = await pluginObjects();
		const good = (await objects.get(key))!;
		await objects.put(key, tgz({ version: "2026.10.2001", tag: "evil" }));

		const worker = await startWorker(s.project, "development");
		try {
			const status = await until(worker.status, (st) => st[pluginStatusKey(s.project, NAME)]?.state === "error");
			expect(status[pluginStatusKey(s.project, NAME)]?.error).toContain("does not match the approved integrity");
			expect(worker.installer.refs()).toEqual([]);

			const admin = await pluginInstallStatus(s.project, NAME);
			expect(admin).toMatchObject({ done: false, failed: true });
			const row = (await s.get(`/${NAME}`)).body;
			expect(row.status).toBe("error");
			expect(row.lastError).toContain(worker.nodeId);
			expect(row.lastError).toContain("does not match the approved integrity");

			// the object is put right and the plugin published again: it installs and the error clears
			await objects.put(key, good);
			expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
			await until(worker.status, () => ready(worker.status(), s.project));
			expect(worker.installer.refs()).toHaveLength(1);
			await pluginInstallStatus(s.project, NAME);
			expect((await s.get(`/${NAME}`)).body).toMatchObject({ status: "ok", lastError: null });
		} finally {
			await worker.stop();
		}
	}, 240_000);

	it("a directory that changed after approval is refused", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fx-plugins-dir-"));
		process.env.FLUXIFY_PLUGINS_DIR = dir;
		try {
			for (const [path, data] of Object.entries(pluginFiles())) {
				mkdirSync(dirname(join(dir, "echo", path)), { recursive: true });
				writeFileSync(join(dir, "echo", path), data);
			}
			const s = await setup();
			expect((await s.post("/fs", { path: "echo" })).status).toBe(200);
			expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
			writeFileSync(join(dir, "echo", "dist", "blocks", "step.js"), "export default { run: () => ({ output: 'evil' }) };");

			const worker = await startWorker(s.project, "development");
			try {
				const status = await until(worker.status, (st) => st[pluginStatusKey(s.project, NAME)]?.state === "error");
				expect(status[pluginStatusKey(s.project, NAME)]?.error).toContain("changed since it was approved");
				expect(worker.installer.refs()).toEqual([]);
				expect((await pluginInstallStatus(s.project, NAME)).failed).toBe(true);
			} finally {
				await worker.stop();
			}
		} finally {
			delete process.env.FLUXIFY_PLUGINS_DIR;
			rmSync(dir, { recursive: true, force: true });
		}
	}, 240_000);

	it("a dependency that will not install fails that plugin only", async () => {
		const s = await projectWith([
			{ name: "acme/plain", version: "2026.10.2001", tag: "plain" },
			// passes the admin's checks, but pins another ms than package.json asks for: the frozen install refuses it
			{ name: "acme/broken", version: "2026.10.2001", tag: "x", useMs: true, lock: STALE_LOCK },
		]);
		const worker = await startWorker(s.project, "development");
		try {
			const status = await until(worker.status, (st) => st[pluginStatusKey(s.project, "acme/broken")]?.state === "error");
			expect(status[pluginStatusKey(s.project, "acme/broken")]?.error).toContain("dependencies did not install");
			await until(worker.status, () => ready(worker.status(), s.project, "acme/plain"));
			expect(worker.installer.refs().map((r) => r.type)).toEqual(["acme/plain/step"]);
		} finally {
			await worker.stop();
		}
	}, 240_000);
});

describe("environments", () => {
	it("switching an environment off unregisters the plugin on that environment's workers only", async () => {
		const s = await projectWith([{ version: "2026.10.2001", tag: "one" }], { dev: true, prod: true });
		const prod = await startWorker(s.project, "production");
		const dev = await startWorker(s.project, "development");
		try {
			await until(prod.status, () => ready(prod.status(), s.project));
			await until(dev.status, () => ready(dev.status(), s.project));

			expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
			await until(prod.status, () => prod.installer.refs().length === 0);
			expect(prod.installer.refs()).toEqual([]);
			expect(prod.status()[pluginStatusKey(s.project, NAME)]).toBeUndefined();
			expect(dev.installer.refs()).toHaveLength(1);
			// only the node in an environment that runs it is asked
			expect((await pluginInstallStatus(s.project, NAME)).nodes.map((n) => n.nodeId)).toEqual([dev.nodeId]);

			expect((await s.put(`/${NAME}/environments`, { dev: false, prod: true })).status).toBe(200);
			await until(dev.status, () => dev.installer.refs().length === 0);
			await until(prod.status, () => ready(prod.status(), s.project));
			expect(dev.installer.refs()).toEqual([]);
			expect(prod.installer.refs()).toHaveLength(1);
		} finally {
			await prod.stop();
			await dev.stop();
		}
	}, 240_000);
});

describe("a new version", () => {
	it("replaces the process exactly once, answers with the new code, and removes the old directory", async () => {
		const s = await projectWith([{ version: "2026.10.2001", tag: "v1" }]);
		const port = 20_000 + Math.floor(Math.random() * 20_000);
		let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
		const supervisor = createExecutionSupervisor({
			projectId: s.project,
			port,
			entry: new URL("./echoChild.fixture.ts", import.meta.url),
			databaseIdleTimeoutMs: 1_000,
			asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
			maxRequestBodyBytes: 1_024,
			scheduleHorizonMs: 1_000,
			logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
			artifacts: () => [],
			trustedOrigins: [],
			baseDomain: () => "",
			timeoutsEnabled: () => false,
			pluginRefs: () => worker?.installer.refs() ?? [],
		});
		const pids = new Set<string>();
		/** the output once the served block answers with `prefix`, the process remembered */
		const answers = async (prefix: string) => {
			let last = "";
			for (let i = 0; i < 600; i++) {
				last = await fetch(`http://127.0.0.1:${port}`).then((r) => r.text()).catch(() => "");
				if (last.startsWith(`${prefix}|`)) break;
				await Bun.sleep(50);
			}
			pids.add(last.split("|")[1]!);
			return last.split("|")[0];
		};

		supervisor.start();
		try {
			// a first install is forwarded to the running process: it does not restart
			const first = await answers("none");
			expect(first).toBe("none");
			const started = [...pids][0];
			worker = await startWorker(s.project, "development", () => supervisor.pluginRefsChanged());
			expect(await answers("v1")).toBe("v1");
			expect([...pids]).toEqual([started!]);
			const v1Dir = dirname(dirname(dirname(worker.installer.refs()[0]!.entry)));

			// a new upload puts the approved plugin back to pending: it unregisters,
			// and approving the new version is an upgrade of what the process holds
			expect((await s.upload(tgz({ version: "2026.10.2002", tag: "v2" }))).status).toBe(200);
			await until(() => worker!.installer.refs(), (refs) => refs.length === 0);
			expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
			expect(await answers("v2")).toBe("v2");
			await worker.installer.idle();

			expect(pids.size).toBe(2);
			expect(existsSync(v1Dir)).toBe(false);
			expect(worker.installer.refs()[0]!.version).toStartWith("2026.10.2002+");
			expect(existsSync(worker.installer.refs()[0]!.entry)).toBe(true);
		} finally {
			supervisor.stop();
			const child = supervisor.child();
			child?.kill();
			await child?.exited;
			await worker?.stop();
		}
	}, 240_000);
});

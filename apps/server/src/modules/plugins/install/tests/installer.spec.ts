import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PluginInstallStatus, pluginStatusKey } from "@fluxify/common/orchestrator";
import { pluginDir } from "../../../packages/depsDir";
import { artifactsCalling, createPluginInstaller, type PluginChange } from "../installer";
import { fsArtifact, NAME, TYPE, writeFsPlugin } from "./fsPlugin";

const source = mkdtempSync(join(tmpdir(), "fx-plugin-src-"));
const root = mkdtempSync(join(tmpdir(), "fx-plugin-root-"));
const KEY = pluginStatusKey("p1", NAME);

let statuses: Record<string, PluginInstallStatus> = {};
let changes: (PluginChange & { watchedExist: boolean[] })[] = [];
/** directories that must still exist when the refs change: the old process is still using them */
let watched: string[] = [];

const installer = createPluginInstaller({
	root,
	onStatus: (s) => {
		statuses = s;
	},
	onRefsChanged: async (change) => {
		changes.push({ ...change, watchedExist: watched.map(existsSync) });
	},
});

beforeAll(() => {
	process.env.FLUXIFY_PLUGINS_DIR = source;
});
afterAll(() => {
	delete process.env.FLUXIFY_PLUGINS_DIR;
	rmSync(source, { recursive: true, force: true });
	rmSync(root, { recursive: true, force: true });
});

async function publish(dir: string, over = {}) {
	const artifact = await fsArtifact(source, dir, over);
	installer.apply("p1", NAME, artifact);
	await installer.idle();
	return artifact;
}

const output = async (entry: string) => (await import(`file://${entry}`)).default.run().output;

describe("plugin installer (directory source)", () => {
	it("copies the directory without node_modules, and hands over where the block is", async () => {
		writeFsPlugin(source, "echo", { tag: "one", version: "2026.10.2001" });
		mkdirSync(join(source, "echo", "node_modules", "junk"), { recursive: true });
		writeFileSync(join(source, "echo", "node_modules", "junk", "index.js"), "x");

		const artifact = await publish("echo");

		expect(statuses[KEY]).toEqual({
			version: "2026.10.2001",
			integrity: artifact.integrity,
			state: "ready",
		});
		const [ref] = installer.refs();
		expect(ref).toMatchObject({ projectId: "p1", type: TYPE, plugin: NAME });
		expect(ref!.version).toStartWith("2026.10.2001+");
		expect(ref!.entry).toStartWith(pluginDir("p1", NAME, "2026.10.2001", root));
		expect(existsSync(ref!.entry)).toBe(true);
		expect(existsSync(join(ref!.entry, "..", "..", "..", "node_modules"))).toBe(false);
		expect(await output(ref!.entry)).toBe("one");
		expect(changes).toEqual([{ projectId: "p1", types: [TYPE], watchedExist: [] }]);
	});

	it("publishing the same plugin again changes nothing", async () => {
		changes = [];
		await publish("echo");
		expect(changes).toEqual([]);
		expect(statuses[KEY]?.state).toBe("ready");
	});

	it("a directory that changed after approval is refused and the plugin keeps what it had", async () => {
		writeFsPlugin(source, "tampered", { tag: "ok", version: "2026.10.2090" });
		const approved = await fsArtifact(source, "tampered");
		writeFileSync(
			join(source, "tampered", "dist", "blocks", "step.js"),
			"export default { run: () => ({ output: 'evil' }) };",
		);
		changes = [];
		installer.apply("p1", NAME, approved);
		await installer.idle();
		// the approved hash no longer matches what is on disk
		expect(statuses[KEY]).toMatchObject({
			state: "error",
			integrity: approved.integrity,
			error: expect.stringContaining("changed since it was approved"),
		});
		expect(changes).toEqual([]);
		expect(installer.refs()).toHaveLength(1);
		expect(installer.refs()[0]!.version).toStartWith("2026.10.2001+");
	});

	it("an unmounted plugins folder is a clear error, not a raw ENOENT", async () => {
		writeFsPlugin(source, "unmounted", { tag: "ok", version: "2026.10.2095" });
		const approved = await fsArtifact(source, "unmounted");
		process.env.FLUXIFY_PLUGINS_DIR = join(source, "not-mounted");
		try {
			installer.apply("p1", NAME, approved);
			await installer.idle();
			expect(statuses[KEY]).toMatchObject({
				state: "error",
				error: expect.stringContaining("plugins folder is not mounted on this worker"),
			});
		} finally {
			process.env.FLUXIFY_PLUGINS_DIR = source;
		}
	});

	it("a new version swaps the refs while the old directory is there, then removes it", async () => {
		writeFsPlugin(source, "echo", { tag: "two", version: "2026.10.2002" });
		const old = installer.refs()[0]!.entry;
		watched = [old];
		changes = [];
		const artifact = await publish("echo");
		expect(changes).toEqual([{ projectId: "p1", types: [TYPE], watchedExist: [true] }]);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(installer.refs()[0]!.entry)).toBe(true);
		expect(statuses[KEY]).toMatchObject({
			version: "2026.10.2002",
			integrity: artifact.integrity,
			state: "ready",
		});
	});

	it("the same version with other bytes gets a directory of its own", async () => {
		const before = installer.refs()[0]!;
		writeFsPlugin(source, "echo", { tag: "two-again", version: "2026.10.2002" });
		await publish("echo");
		const after = installer.refs()[0]!;
		// one version string would be a loaded module the child cannot replace
		expect(after.version).not.toBe(before.version);
		expect(after.entry).not.toBe(before.entry);
		expect(existsSync(before.entry)).toBe(false);
		expect(await output(after.entry)).toBe("two-again");
	});

	it("applies only the latest of a burst", async () => {
		for (const version of ["2026.10.2003", "2026.10.2004", "2026.10.2005"]) {
			writeFsPlugin(source, `v${version}`, { tag: version, version });
			installer.apply("p1", NAME, await fsArtifact(source, `v${version}`));
		}
		await installer.idle();
		expect(installer.refs()[0]!.version).toStartWith("2026.10.2005+");
		// the first started at once; the second never did
		expect(existsSync(pluginDir("p1", NAME, "2026.10.2004", root))).toBe(false);
	});

	it("a location that leaves the plugins directory is refused", async () => {
		const bad = pluginStatusKey("p1", "acme/bad");
		installer.apply(
			"p1",
			"acme/bad",
			await fsArtifact(source, "echo", { name: "acme/bad", location: "../echo" }),
		);
		await installer.idle();
		expect(statuses[bad]).toMatchObject({
			state: "error",
			error: expect.stringContaining("is not a plugin directory"),
		});
		installer.apply("p1", "acme/bad", null);
		await installer.idle();
		expect(statuses[bad]).toBeUndefined();
	});

	it("a removed plugin stops being served, and its status is cleared", async () => {
		changes = [];
		const dir = installer.refs()[0]!.entry;
		watched = [dir];
		installer.apply("p1", NAME, null);
		await installer.idle();
		expect(installer.refs()).toEqual([]);
		expect(statuses[KEY]).toBeUndefined();
		expect(changes).toEqual([{ projectId: "p1", types: [], watchedExist: [true] }]);
		// a development and a production worker can share the volume: nothing is deleted under the other
		expect(existsSync(dir)).toBe(true);
	});
});

describe("artifactsCalling", () => {
	const entries = [
		{ key: "a", value: { projectId: "p1", pluginBlocks: [TYPE] } },
		{ key: "b", value: { projectId: "p1", pluginBlocks: ["acme/other/x"] } },
		{ key: "c", value: { projectId: "p2", pluginBlocks: [TYPE] } },
		{ key: "d", value: { projectId: "p1" } },
		{ key: "e", value: null },
	];
	it("finds the artifacts of the project that call the blocks", () => {
		expect(artifactsCalling(entries, "p1", [TYPE]).map((e) => e.key)).toEqual(["a"]);
		expect(artifactsCalling(entries, "p1", [])).toEqual([]);
	});
});

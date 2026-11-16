import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestError } from "../../../../errors/badRequestError";
import { hashFiles } from "../../../plugins/sources/integrity";
import { exportTarball } from "../pluginBytes";

/** the real folder reader, no mocks: a folder plugin whose files moved on after approval */
let root: string;
const saved = process.env.FLUXIFY_PLUGINS_DIR;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fx-plugins-"));
	await mkdir(join(root, "demo"));
	process.env.FLUXIFY_PLUGINS_DIR = root;
});
afterEach(async () => {
	if (saved === undefined) delete process.env.FLUXIFY_PLUGINS_DIR;
	else process.env.FLUXIFY_PLUGINS_DIR = saved;
	await rm(root, { recursive: true, force: true });
});

const approved = new Map([["index.js", new TextEncoder().encode("export default 1")]]);
const folder = { version: "1.0.0", source: "fs" as const, location: "demo", integrity: hashFiles(approved) };

describe("exporting a folder plugin for a backup", () => {
	it("packs the folder while it still matches what was approved", async () => {
		await writeFile(join(root, "demo", "index.js"), "export default 1");
		const bytes = await exportTarball("demo", folder);
		const files = await new Bun.Archive(bytes).files();
		expect([...files.keys()]).toEqual(["package/index.js"]);
	});

	it("names the plugin and says to approve it again when the folder changed", async () => {
		await writeFile(join(root, "demo", "index.js"), "export default 2");
		const error = await exportTarball("demo", folder).catch((e) => e);
		expect(error).toBeInstanceOf(BadRequestError);
		expect(error.message).toContain('Plugin "demo" 1.0.0');
		expect(error.message).toContain("changed since it was approved");
		expect(error.message).toContain("Approve the changed version again");
		expect(error.message).toContain("untick Plugins");
	});

	it("says the folder isn't mounted when FLUXIFY_PLUGINS_DIR is not set", async () => {
		delete process.env.FLUXIFY_PLUGINS_DIR;
		const error = await exportTarball("demo", folder).catch((e) => e);
		expect(error.message).toContain('Plugin "demo"');
		expect(error.message).toContain("FLUXIFY_PLUGINS_DIR");
		expect(error.message).toContain("untick Plugins");
	});

});

import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as natsObjects from "../../../db/natsObjects";
import { hashFiles, sha256Integrity } from "../sources/integrity";
import { readTree } from "../sources/tree";

// The source checks for an upload, npm and the filesystem. The registry is a
// stand-in `fetch`: its URL is fixed when another spec loads it first.
let listed: Record<string, unknown> | null = { "1.0.0": { dist: { integrity: "sha512-ok" } } };
beforeAll(() => {
	spyOn(globalThis, "fetch").mockImplementation((async () =>
		listed ? Response.json({ versions: listed }) : new Response(null, { status: 404 })) as any);
});
const { checkSource } = await import("../sourceCheck");

const dir = mkdtempSync(join(tmpdir(), "scan-"));
afterAll(() => {
	mock.restore();
	rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
	delete process.env.FLUXIFY_PLUGINS_DIR;
});

const bytes = new TextEncoder().encode("tarball");
const stored = (value: Uint8Array | null) =>
	spyOn(natsObjects, "pluginObjects").mockResolvedValue({ get: async () => value } as any);
const row = (over: object) => ({
	name: "@acme/echo",
	version: "1.0.0",
	source: "upload" as const,
	location: "p/@acme/echo/1.0.0.tgz",
	integrity: sha256Integrity(bytes),
	...over,
});

describe("upload and url", () => {
	it("is healthy when the object matches", async () => {
		stored(bytes);
		expect(await checkSource(row({}))).toBeNull();
	});
	it("reports a missing object", async () => {
		stored(null);
		expect(await checkSource(row({}))).toContain("missing");
	});
	it("reports hash drift", async () => {
		stored(new TextEncoder().encode("other"));
		expect(await checkSource(row({}))).toContain("no longer matches");
	});
});

describe("npm", () => {
	const npm = row({ source: "npm", location: "@acme/echo@1.0.0", integrity: "sha512-ok" });
	it("is healthy when the registry still lists the same hash", async () => {
		expect(await checkSource(npm)).toBeNull();
	});
	it("reports a version that is gone", async () => {
		listed = {};
		expect(await checkSource(npm)).toContain("no longer on the npm registry");
		listed = { "1.0.0": { dist: { integrity: "sha512-ok" } } };
	});
	it("reports a changed hash", async () => {
		listed = { "1.0.0": { dist: { integrity: "sha512-evil" } } };
		expect(await checkSource(npm)).toContain("different hash");
		listed = { "1.0.0": { dist: { integrity: "sha512-ok" } } };
	});
	it("reports a package that is gone", async () => {
		listed = null;
		expect(await checkSource(npm)).toContain("no longer on the npm registry");
		listed = { "1.0.0": { dist: { integrity: "sha512-ok" } } };
	});
});

describe("filesystem", () => {
	it("is healthy until a file changes", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = dir;
		const plugin = join(dir, "echo");
		mkdirSync(plugin, { recursive: true });
		writeFileSync(join(plugin, "fluxify.json"), "{}");
		const fs = row({ source: "fs", location: "echo", integrity: hashFiles(await readTree(plugin)) });
		expect(await checkSource(fs)).toBeNull();
		writeFileSync(join(plugin, "fluxify.json"), '{"changed":true}');
		expect(await checkSource(fs)).toContain("has changed");
	});
	it("reports a directory that is gone, and an unset root", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = dir;
		expect(await checkSource(row({ source: "fs", location: "nope" }))).toContain("Could not check");
		delete process.env.FLUXIFY_PLUGINS_DIR;
		expect(await checkSource(row({ source: "fs", location: "echo" }))).toContain("No plugins directory");
	});
});

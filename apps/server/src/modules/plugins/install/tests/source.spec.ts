import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { pluginTgz } from "../../sources/tests/tarball";

// The npm source reads a registry over HTTP; a stand-in one proves what a worker
// accepts. The registry URL is read when the module loads, so it is set first.
const good = pluginTgz();
const tampered = pluginTgz({ "dist/blocks/step.js": "export default { evil: true };" });
const sri = (bytes: Uint8Array) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

let served = good;
let listed = true;
const registry = Bun.serve({
	port: 0,
	fetch(req) {
		const { pathname } = new URL(req.url);
		if (pathname === "/tarball.tgz") return new Response(served as BodyInit);
		if (pathname !== "/@acme%2fecho") return new Response(null, { status: 404 });
		return Response.json({
			versions: listed
				? { "2026.10.2001": { dist: { tarball: `http://127.0.0.1:${registry.port}/tarball.tgz` } } }
				: {},
		});
	},
});

let fetchPluginFiles: typeof import("../source").fetchPluginFiles;
beforeAll(async () => {
	process.env.NPM_REGISTRY_URL = `http://127.0.0.1:${registry.port}`;
	({ fetchPluginFiles } = await import("../source"));
});
afterAll(() => {
	delete process.env.NPM_REGISTRY_URL;
	registry.stop(true);
});

const npm = (integrity: string) => ({
	source: "npm" as const,
	location: "@acme/echo@2026.10.2001",
	integrity,
});

describe("fetchPluginFiles (npm)", () => {
	it("unpacks the tarball the registry's hash vouches for", async () => {
		const files = await fetchPluginFiles(npm(sri(good)));
		expect([...files.keys()]).toContain("fluxify.json");
	});

	it("refuses a tarball that is not the one approved", async () => {
		served = tampered;
		await expect(fetchPluginFiles(npm(sri(good)))).rejects.toThrow("integrity");
		served = good;
	});

	it("says so when the version has left the registry", async () => {
		listed = false;
		await expect(fetchPluginFiles(npm(sri(good)))).rejects.toThrow("is no longer on the registry");
		listed = true;
	});
});

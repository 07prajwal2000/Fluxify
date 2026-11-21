import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EncryptionService } from "../../../lib/encryption";
import { type Payload, writeArchive } from "../archive";
import { backupFiles, openTree, type TreeFile } from "../gitTree";
import { KEY, OTHER_KEY, setKey } from "./stubs";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function archive(readme?: string) {
	const payload: Payload = new Map([
		["sections/appConfig.json", enc({ keys: [{ key: "API", value: "secret" }] })],
		["sections/integrations.json", enc({ integrations: [] })],
		["sections/routes.json", enc({ routes: [{ name: "a", path: "/a" }] })],
		["files/plugins/p.tgz", new Uint8Array([1, 2, 3])],
	]);
	const head = {
		mode: "backup" as const,
		release: "dev",
		createdAt: "2026-11-21T00:00:00.000Z",
		source: { name: "Shop", slug: "shop" },
		sections: { appConfig: 1, integrations: 1, routes: 1 },
	};
	const { manifest } = await writeArchive(head, payload, readme);
	return { manifest, payload, readme };
}

/** what the repository would hold: sealed files encrypted, as the destination writes them */
const committed = (files: Map<string, TreeFile>) =>
	new Map(
		[...files].map(([path, f]) => [
			path,
			"bytes" in f ? f.bytes : EncryptionService.encryptBytes(f.seal),
		]),
	);

beforeEach(() => {
	mock.restore();
	setKey(KEY);
});

describe("a backup as a git folder", () => {
	it("seals only appConfig and integrations, and indents sections for diffs", async () => {
		const files = backupFiles(await archive("# note"), true);
		expect([...files.keys()].sort()).toEqual([
			"README.md",
			"files/plugins/p.tgz",
			"manifest.json",
			"sections/appConfig.json.enc",
			"sections/integrations.json.enc",
			"sections/routes.json",
		]);
		const routes = files.get("sections/routes.json")!;
		expect("bytes" in routes && text(routes.bytes)).toContain('\n  "routes": [');
	});

	it("writes every section as plain JSON when encryption is off", async () => {
		const files = backupFiles(await archive(), false);
		expect(files.has("sections/appConfig.json")).toBe(true);
		expect(files.has("README.md")).toBe(false);
		expect([...files.keys()].some((p) => p.endsWith(".enc"))).toBe(false);
	});

	for (const sealed of [true, false])
		it(`reads back to the same payload and passes the integrity check (sealed: ${sealed})`, async () => {
			const a = await archive("# note");
			const opened = openTree(committed(backupFiles(a, sealed)));
			expect(opened.warnings).toEqual([]);
			expect(opened.readme).toBe("# note");
			expect(opened.manifest.sections).toEqual(a.manifest.sections);
			expect([...opened.payload.keys()].sort()).toEqual([...a.payload.keys()].sort());
			for (const [path, bytes] of a.payload) expect(opened.payload.get(path)).toEqual(bytes);
		});

	it("skips sealed sections another key made, with a warning, and restores the rest", async () => {
		const files = committed(backupFiles(await archive(), true));
		setKey(OTHER_KEY);
		const opened = openTree(files);
		expect(Object.keys(opened.manifest.sections)).toEqual(["routes"]);
		expect(opened.warnings!.map((w) => w.section).sort()).toEqual(["appConfig", "integrations"]);
		expect(opened.payload.has("sections/routes.json")).toBe(true);
	});

	it("refuses a folder whose plain sections were edited", async () => {
		const files = committed(backupFiles(await archive(), true));
		files.set("sections/routes.json", enc({ routes: [] }));
		expect(() => openTree(files)).toThrow("damaged or was altered");
	});

	it("refuses a folder without a manifest", () => {
		expect(() => openTree(new Map())).toThrow("isn't a Fluxify project backup");
	});
});

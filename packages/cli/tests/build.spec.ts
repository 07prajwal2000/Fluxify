import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { build } from "../src/build";
import { blockSrc, cleanup, failures, LOCK, makePlugin } from "./helpers";

afterAll(cleanup);

/** src/index.ts for acme/t, with `over` in place of its fields (undefined drops one) */
const index = (over: Record<string, unknown> = {}) =>
	`import { plugin } from "@fluxify/sdk";
export default plugin(${JSON.stringify({ name: "acme/t", url: "https://example.com/acme/t", ...over })});
`;

const tarNames = async (root: string, tarball: string) =>
	[...(await new Bun.Archive(await Bun.file(join(root, tarball)).bytes()).files()).keys()].map(
		(n) => n.replace(/^package\//, ""),
	);

describe("blocks build", () => {
	it("writes dist/, a valid fluxify.json and a tarball with only what ships", async () => {
		const root = await makePlugin({
			"src/blocks/messages/post.ts": blockSrc("acme/t/messages/post"),
			"src/lib.ts": "export const shout = (s: string) => s.toUpperCase();",
			"icons/hello.svg": "<svg/>",
		});
		const { manifest, tarball, warnings } = await build(root);
		expect(warnings).toEqual([]);
		expect(tarball).toBe("acme-t-1.2.3.tgz");
		expect(Object.keys(manifest.blocks)).toEqual(["acme/t/hello", "acme/t/messages/post"]);
		expect(manifest.blocks["acme/t/messages/post"].entry).toBe("dist/blocks/messages/post.js");
		expect(manifest).toMatchObject({ name: "acme/t", sdk: ">=2026.10.2001" });
		expect(fluxifyManifestSchema.parse(await Bun.file(join(root, "fluxify.json")).json())).toEqual(
			manifest,
		);
		const names = await tarNames(root, tarball);
		expect(names).toEqual(
			expect.arrayContaining([
				"package.json",
				"bun.lock",
				"fluxify.json",
				"dist/blocks/hello.js",
				"dist/blocks/messages/post.js",
				"icons/hello.svg",
			]),
		);
		expect(names.filter((n) => /^src\/|node_modules/.test(n))).toEqual([]);
		// the shipped lockfile is the author's, byte for byte, not an empty file
		const shipped = (await new Bun.Archive(await Bun.file(join(root, tarball)).bytes()).files()).get(
			"package/bun.lock",
		);
		expect(await shipped?.text()).toBe(LOCK);
	});

	it("keeps npm packages external and shares code between blocks as chunks", async () => {
		const shared =
			'import { z } from "zod";\nexport const parse = (v: unknown) => z.string().parse(v);\n';
		const use = (type: string) =>
			blockSrc(type, {
				before: 'import { parse } from "../shared";',
				body: "return { output: parse(1) };",
			});
		const root = await makePlugin({
			"src/shared.ts": shared,
			"src/blocks/hello.ts": use("acme/t/hello"),
			"src/blocks/other.ts": use("acme/t/other"),
		});
		await build(root);
		const out = await Bun.file(join(root, "dist/blocks/hello.js")).text();
		expect(out).toContain('"@fluxify/sdk/blocks"');
		const chunks = [...new Bun.Glob("dist/chunks/*.js").scanSync(root)];
		expect(chunks.length).toBeGreaterThan(0);
		const chunk = await Bun.file(join(root, chunks[0])).text();
		expect(chunk).toContain('from "zod"');
		expect(chunk.length).toBeLessThan(2000); // zod itself is not in it
	});

	it("needs no bun.lock when only the worker's packages are used, and ships none", async () => {
		const root = await makePlugin({ "bun.lock": null });
		const { tarball } = await build(root);
		expect(await tarNames(root, tarball)).not.toContain("bun.lock");
	});

	it("copies an icon outside icons/ into it and points the manifest there", async () => {
		const root = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", { extra: 'icon: "./logo.svg",' }),
			"logo.svg": "<svg/>",
		});
		const { manifest, tarball } = await build(root);
		expect(manifest.blocks["acme/t/hello"].icon).toBe("icons/logo.svg");
		expect(await tarNames(root, tarball)).toContain("icons/logo.svg");
	});
});

describe("blocks build fails", () => {
	it("without an https url in src/index.ts", async () => {
		const noUrl = await makePlugin({ "src/index.ts": index({ url: undefined }) });
		expect(await failures(noUrl)).toEqual([expect.stringMatching(/^src\/index\.ts: plugin acme\/t: .*url/)]);
		const http = await makePlugin({ "src/index.ts": index({ url: "http://example.com" }) });
		expect(await failures(http)).toEqual([expect.stringContaining("https://")]);
	});

	it("with runtime dependencies and a missing, empty or unparseable bun.lock", async () => {
		const deps = { dependencies: { ms: "2.1.3" } };
		for (const [lock, problem] of [
			[null, "bun.lock is missing or empty"],
			["", "bun.lock is missing or empty"],
			["{ not json", "bun.lock does not parse"],
			['{ "packages": {} }', "bun.lock has no lockfileVersion"],
			[LOCK, "bun.lock does not pin ms"],
		] as const) {
			const root = await makePlugin({ "bun.lock": lock }, deps);
			expect(await failures(root)).toEqual([expect.stringContaining(problem)]);
		}
	});

	it("with @fluxify/sdk or zod in dependencies: the worker provides them", async () => {
		const root = await makePlugin(
			{},
			{
				dependencies: { "@fluxify/sdk": ">=2026.10.2001", zod: "^4.0.0" },
				peerDependencies: { "@fluxify/sdk": ">=2026.10.2001" },
			},
		);
		expect(await failures(root)).toEqual([
			expect.stringContaining('@fluxify/sdk is in "dependencies": move it to "peerDependencies"'),
			expect.stringContaining('zod is in "dependencies": move it to "peerDependencies"'),
		]);
	});

	it("on an SDK range it cannot read", async () => {
		const root = await makePlugin({}, { peerDependencies: { "@fluxify/sdk": "latest" } });
		expect(await failures(root)).toEqual([expect.stringContaining("@fluxify/sdk range")]);
	});

	it("on an icon over the custom block limit", async () => {
		const root = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", { extra: 'icon: "./icons/big.svg",' }),
			"icons/big.svg": `<svg>${"x".repeat(60_000)}</svg>`,
		});
		expect(await failures(root)).toEqual([expect.stringMatching(/icon .* the limit is 68266/)]);
	});

	it("on an icon that is missing or outside the plugin", async () => {
		const missing = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", { extra: 'icon: "./icons/none.svg",' }),
		});
		expect(await failures(missing)).toEqual([expect.stringContaining("does not exist")]);
		const outside = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", { extra: 'icon: "../x.svg",' }),
		});
		expect(await failures(outside)).toEqual([expect.stringContaining("outside the plugin")]);
	});

	it("on a block the SDK rejects", async () => {
		const root = await makePlugin({
			"src/blocks/hello.ts": blockSrc("acme/t/hello", {
				extra: 'params: { order: { type: "string" } },',
			}),
		});
		expect(await failures(root)).toEqual([
			expect.stringMatching(/src\/blocks\/hello\.ts: .*reserved/),
		]);
	});

	it("when a file default-exports no block", async () => {
		const root = await makePlugin({ "src/blocks/hello.ts": "export default 1;" });
		expect(await failures(root)).toEqual(["src/blocks/hello.ts: must default-export a block(...)"]);
	});

	it("when the name does not match the path", async () => {
		const root = await makePlugin({ "src/blocks/hello.ts": blockSrc("acme/t/other") });
		expect(await failures(root)).toEqual([
			expect.stringContaining("name 'acme/t/other' must be 'acme/t/hello'"),
		]);
	});

	it("when two blocks declare the same type", async () => {
		const root = await makePlugin({ "src/blocks/copy.ts": blockSrc("acme/t/hello") });
		const problems = await failures(root);
		expect(problems[0]).toContain(
			"src/blocks/copy.ts and src/blocks/hello.ts both declare the type 'acme/t/hello'",
		);
	});

	it("without any block", async () => {
		const root = await makePlugin({ "src/blocks/hello.ts": null });
		expect(await failures(root)).toEqual([expect.stringContaining("no blocks in src/blocks")]);
	});

	it("when package.json would pack src/ (no files list)", async () => {
		const root = await makePlugin({}, { files: undefined });
		expect(await failures(root)).toEqual([expect.stringContaining('set "files"')]);
		expect(existsSync(join(root, "acme-t-1.2.3.tgz"))).toBe(false);
	});
});

describe("plugin metadata from src/index.ts", () => {
	const manifestOf = async (root: string) => Bun.file(join(root, "fluxify.json")).json();
	const pkgOf = async (root: string) => Bun.file(join(root, "package.json")).json();

	it("writes fluxify.json from it and the blocks, plugin icons shipped like a block's", async () => {
		const root = await makePlugin({
			"src/index.ts": index({ description: "Test blocks", icon: "./logo.svg", scopeIcon: "./icons/acme.svg" }),
			"logo.svg": "<svg/>",
			"icons/acme.svg": "<svg>a</svg>",
		});
		const { manifest, tarball } = await build(root);
		expect(manifest).toMatchObject({
			name: "acme/t",
			url: "https://example.com/acme/t",
			description: "Test blocks",
			icon: "icons/logo.svg",
			scopeIcon: "icons/acme.svg",
		});
		expect(Object.keys(manifest.blocks)).toEqual(["acme/t/hello"]);
		expect(await manifestOf(root)).toEqual(manifest);
		expect(await tarNames(root, tarball)).toEqual(expect.arrayContaining(["fluxify.json", "icons/logo.svg"]));
	});

	it("overwrites a hand-edited fluxify.json", async () => {
		const root = await makePlugin();
		await build(root);
		await Bun.write(join(root, "fluxify.json"), JSON.stringify({ ...(await manifestOf(root)), name: "acme/other", blocks: {} }));
		await build(root);
		const manifest = await manifestOf(root);
		expect(manifest.name).toBe("acme/t");
		expect(Object.keys(manifest.blocks)).toEqual(["acme/t/hello"]);
	});

	it("adds package.json's fluxify field when it is missing", async () => {
		const root = await makePlugin({}, { fluxify: undefined, devDependencies: { "@fluxify/sdk": "*" } });
		await build(root);
		expect((await pkgOf(root)).fluxify).toEqual({ name: "acme/t", url: "https://example.com/acme/t" });
	});

	it("fails with the difference when package.json drifted from it", async () => {
		const root = await makePlugin({}, { fluxify: { name: "acme/old", url: "https://example.com/old" } });
		expect(await failures(root)).toEqual([
			'package.json "fluxify.name" is "acme/old" but src/index.ts says "acme/t": make them match',
			'package.json "fluxify.url" is "https://example.com/old" but src/index.ts says "https://example.com/acme/t": make them match',
		]);
		expect((await pkgOf(root)).fluxify.name).toBe("acme/old");
	});

	it("fails without src/index.ts, or when it exports no plugin", async () => {
		expect(await failures(await makePlugin({ "src/index.ts": null }))).toEqual([
			expect.stringContaining("src/index.ts is missing"),
		]);
		expect(await failures(await makePlugin({ "src/index.ts": "export default 1;" }))).toEqual([
			expect.stringContaining("src/index.ts must default-export plugin({ name, url })"),
		]);
	});
});

describe("param tabs", () => {
	const withTabs = (extra: string) => makePlugin({ "src/blocks/hello.ts": blockSrc("acme/t/hello", { before: 'import { param } from "@fluxify/sdk/blocks";', extra }) });

	it("writes the resolved tabs and order, and warns about a tab the list leaves out", async () => {
		const root = await withTabs(
			'tabs: ["Auth"], params: { a: param.string({ order: 2 }), b: param.string({ tab: "Auth" }), c: param.string({ tab: "Extra" }), d: param.string({ order: 1 }) },',
		);
		const { manifest, warnings } = await build(root);
		const entry = manifest.blocks["acme/t/hello"];
		expect(entry.tabs).toEqual(["General", "Auth", "Extra"]);
		expect(Object.fromEntries(Object.entries(entry.params).map(([k, p]) => [k, (p as { order: number }).order]))).toEqual({ a: 1, b: 0, c: 0, d: 0 });
		expect(warnings).toEqual(["acme/t/hello: param 'c' is in a tab that tabs does not list, so it is shown after them"]);
	});

	it("fails on a tabs entry no param uses", async () => {
		const root = await withTabs('tabs: ["General", "Ghost"], params: { a: param.string() },');
		expect(await failures(root)).toEqual([expect.stringContaining("tabs lists 'Ghost', which no param uses")]);
	});
});

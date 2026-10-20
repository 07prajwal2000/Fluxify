import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { build } from "../src/build";
import { main } from "../src/cli";
import { create } from "../src/create";
import { init } from "../src/init";
import { cleanup, makePlugin, tmp } from "./helpers";

afterAll(cleanup);

const read = (root: string, path: string) => Bun.file(join(root, path)).text();
const message = (run: () => Promise<unknown>) =>
	run().then(
		() => "",
		(error: Error) => error.message,
	);
const flags = { name: "acme/slack", url: "https://example.com/slack", install: false };

describe("init", () => {
	it("writes an empty plugin project and no block", async () => {
		const cwd = tmp();
		const { root, files, installed } = await init({ cwd, dir: "slack", ...flags });
		expect(root).toBe(join(cwd, "slack"));
		expect(installed).toBe(false);
		expect(files.sort()).toEqual([
			".gitignore",
			"README.md",
			"icons/.gitkeep",
			"package.json",
			"src/blocks/.gitkeep",
			"tsconfig.json",
		]);
		const pkg = JSON.parse(await read(root, "package.json"));
		expect(pkg).toMatchObject({
			name: "@acme/slack",
			version: "0.1.0",
			type: "module",
			scripts: { build: "fluxify-cli blocks build", test: "bun test" },
		});
		// the same schema the registry reads `fluxify.json` with
		expect(pkg.fluxify).toEqual({ name: "acme/slack", url: "https://example.com/slack" });
		expect(fluxifyManifestSchema.shape.name.safeParse(pkg.fluxify.name).success).toBe(true);
		expect(fluxifyManifestSchema.shape.url.safeParse(pkg.fluxify.url).success).toBe(true);
		// the worker provides both: peers, with dev copies for building and testing
		expect(pkg.dependencies).toBeUndefined();
		expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["@fluxify/sdk", "zod"]);
		expect(Object.keys(pkg.devDependencies).sort()).toEqual([
			"@fluxify/cli",
			"@fluxify/sdk",
			"@types/bun",
			"typescript",
			"zod",
		]);
		expect(await read(root, ".gitignore")).toContain("fluxify.json");
		expect(await read(root, "README.md")).toContain("https://example.com/slack");
		expect(existsSync(join(root, "bun.lock"))).toBe(false);
	});

	it("initialises the current directory when none is given", async () => {
		const cwd = tmp();
		const { root } = await init({ cwd, ...flags });
		expect(root).toBe(cwd);
		expect(existsSync(join(cwd, "package.json"))).toBe(true);
	});

	it("asks for a missing --name and --url when it can", async () => {
		const asked: string[] = [];
		const answers = ["acme/asked", "https://example.com/asked"];
		const { root } = await init({
			cwd: tmp(),
			install: false,
			ask: async (q) => {
				asked.push(q);
				return answers.shift() ?? "";
			},
		});
		expect(asked).toHaveLength(2);
		expect(JSON.parse(await read(root, "package.json")).fluxify.name).toBe("acme/asked");
	});

	it("names the missing flag when there is no terminal to ask on", async () => {
		const cwd = tmp();
		expect(await message(() => init({ cwd, url: flags.url, install: false }))).toContain("--name");
		expect(await message(() => init({ cwd, name: flags.name, install: false }))).toContain("--url");
		expect(existsSync(join(cwd, "package.json"))).toBe(false);
	});

	it("refuses an invalid name and a non-https url", async () => {
		const cwd = tmp();
		expect(await message(() => init({ cwd, ...flags, name: "Acme" }))).toContain("--name 'Acme'");
		expect(await message(() => init({ cwd, ...flags, name: "slack" }))).toContain("--name");
		expect(await message(() => init({ cwd, ...flags, url: "http://example.com" }))).toContain(
			"https://",
		);
	});

	it("refuses an existing plugin, and a plain package.json without --force", async () => {
		const plugin = await makePlugin();
		expect(await message(() => init({ cwd: plugin, ...flags, force: true }))).toBe(
			"already a Fluxify plugin",
		);

		const plain = tmp();
		await Bun.write(join(plain, "package.json"), '{"name":"mine"}');
		expect(await message(() => init({ cwd: plain, ...flags }))).toContain("use --force");
		expect(await read(plain, "package.json")).toBe('{"name":"mine"}');
		await init({ cwd: plain, ...flags, force: true });
		expect(JSON.parse(await read(plain, "package.json")).fluxify.name).toBe("acme/slack");
	});

	it("never overwrites a file without --force", async () => {
		const cwd = tmp();
		await Bun.write(join(cwd, "README.md"), "mine");
		expect(await message(() => init({ cwd, ...flags }))).toContain("README.md already exists");
		expect(await read(cwd, "README.md")).toBe("mine");
		await init({ cwd, ...flags, force: true });
		expect(await read(cwd, "README.md")).toContain("acme/slack");
	});

	// the one test that installs for real: the SDK is not on npm yet, so it comes from the workspace
	it("installs so that bun.lock exists, then create and build pass with no warnings", async () => {
		const cwd = tmp();
		const sdk = `file:${join(import.meta.dir, "..", "..", "sdk")}`;
		const { root } = await init({
			cwd,
			...flags,
			install: true,
			specs: { sdk, cli: null, typescript: "^5.9.2" },
		});
		expect(existsSync(join(root, "bun.lock"))).toBe(true);
		// once published, the scaffolded range is what the manifest records
		const pkg = JSON.parse(await read(root, "package.json"));
		pkg.peerDependencies["@fluxify/sdk"] = ">=2026.10.2001";
		await Bun.write(join(root, "package.json"), JSON.stringify(pkg));

		await create({ cwd: root, name: "post" });
		const { warnings, tarball, manifest } = await build(root);
		expect(warnings).toEqual([]);
		expect(tarball).toBe("acme-slack-0.1.0.tgz");
		expect(Object.keys(manifest.blocks)).toEqual(["acme/slack/post"]);
		// the scaffolded test passes out of the box, against the harness
		const test = Bun.spawnSync([process.execPath, "test"], { cwd: root, env: { ...process.env, NODE_ENV: "test" } });
		expect(`${test.stderr}`).toContain("2 pass");
		expect(test.exitCode).toBe(0);
	}, 180_000);
});

describe("fluxify-cli init", () => {
	it("--no-install writes no lockfile and says build needs it", async () => {
		const cwd = tmp();
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			const code = await main(
				["init", "slack", "--name", flags.name, "--url", flags.url, "--no-install"],
				cwd,
			);
			expect(code).toBe(0);
			const out = log.mock.calls.map((c) => c[0]).join("\n");
			expect(out).toContain("skipped bun install");
			expect(out).toContain("cd slack");
			expect(out).toContain("fluxify-cli blocks create <name>");
			expect(out).toContain("bun run build");
			expect(existsSync(join(cwd, "slack", "bun.lock"))).toBe(false);
		} finally {
			log.mockRestore();
		}
	});

	it("exits 1 naming the flag when stdin is not a terminal", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await main(["init", "--no-install"], tmp())).toBe(1);
			expect(errors.mock.calls[0][0]).toContain("--name is required");
		} finally {
			errors.mockRestore();
		}
	});
});

describe("blocks create", () => {
	it("fails outside a plugin and tells the author to run init", async () => {
		expect(await message(() => create({ cwd: tmp(), name: "post" }))).toBe(
			"not a Fluxify plugin, run `fluxify-cli init` first",
		);
	});

	it("adds a block under src/blocks, folders included, from any subfolder", async () => {
		const root = await makePlugin({ "bun.lock": null });
		const { files } = await create({ cwd: join(root, "src"), name: "messages/post" });
		expect(files).toEqual(["src/blocks/messages/post.ts", "src/blocks/messages/post.test.ts"]);
		expect(await read(root, "src/blocks/messages/post.test.ts")).toContain('import block from "./post"');
		expect(await read(root, "src/blocks/messages/post.ts")).toContain(
			'name: "acme/t/messages/post"',
		);
	});

	it("refuses an existing block and names the SDK rejects", async () => {
		const root = await makePlugin();
		expect(await message(() => create({ cwd: root, name: "hello" }))).toContain("already exists");
		for (const name of ["Post", "a b", "../up", "a//b", "-a"])
			expect(await message(() => create({ cwd: root, name }))).toContain("not a block name");
	});

	it("a block it adds builds", async () => {
		const root = await makePlugin();
		await create({ cwd: root, name: "world" });
		const { manifest, warnings } = await build(root);
		expect(Object.keys(manifest.blocks)).toEqual(["acme/t/hello", "acme/t/world"]);
		expect(warnings).toEqual([]);
	});
});

describe("blocks build on an empty plugin", () => {
	it("fails with how to add a block", async () => {
		const cwd = tmp();
		const { root } = await init({ cwd, ...flags });
		await Bun.write(join(root, "bun.lock"), (await import("./helpers")).LOCK);
		expect(await message(() => build(root))).toBe(
			"no blocks in src/blocks, add one with `fluxify-cli blocks create <name>`",
		);
	});
});

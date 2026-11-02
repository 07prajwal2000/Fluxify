import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { build } from "../src/build";
import { main } from "../src/cli";
import { addToIndex, create } from "../src/create";
import { init } from "../src/init";
import { cleanup, linkModules, makePlugin, tmp } from "./helpers";

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
			"src/index.ts",
			"tsconfig.json",
		]);
		const pkg = JSON.parse(await read(root, "package.json"));
		expect(pkg).toMatchObject({
			name: "@acme/slack",
			version: "0.1.0",
			type: "module",
			scripts: { build: "fluxify-cli build", test: "bun test" },
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
		expect(files).toEqual(["src/blocks/messages/post.ts", "src/blocks/messages/post.test.ts", "src/index.ts"]);
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

describe("fluxify-cli build on an empty plugin", () => {
	it("fails with how to add a block", async () => {
		const cwd = tmp();
		const { root } = await init({ cwd, ...flags });
		await Bun.write(join(root, "bun.lock"), (await import("./helpers")).LOCK);
		linkModules(root);
		expect(await message(() => build(root))).toBe(
			"src/index.ts lists nothing to ship. Import each resource and add it to blocks, triggers or integrations in plugin({...}), or add one with `fluxify-cli blocks create <name>`",
		);
	});
});

describe("init answers", () => {
	const pkg = async (root: string) => JSON.parse(await read(root, "package.json"));

	it("with no flag, asks name, url, version and description one by one; Enter takes a default", async () => {
		const asked: string[] = [];
		const answers = ["acme/q", "https://example.com/q", "", "Slack things"];
		const { root } = await init({
			cwd: tmp(),
			install: false,
			ask: async (q) => (asked.push(q), answers.shift() ?? ""),
		});
		expect(asked.map((q) => q.split(" (")[0])).toEqual(["Plugin name", "Docs or source URL", "Version", "Description"]);
		expect(asked[2]).toContain("(0.1.0)");
		const p = await pkg(root);
		expect([p.version, p.description]).toEqual(["0.1.0", "Slack things"]);
		expect(await read(root, "src/index.ts")).toContain('description: "Slack things",');
	});

	it("a flag answers its question; the rest default without asking, only a missing name or url is asked", async () => {
		const asked: string[] = [];
		const { root } = await init({
			cwd: tmp(),
			install: false,
			name: flags.name,
			ask: async (q) => (asked.push(q), flags.url),
		});
		expect(asked).toHaveLength(1);
		const p = await pkg(root);
		expect([p.version, p.description]).toEqual(["0.1.0", undefined]);
		expect(await read(root, "src/index.ts")).toContain('// description: "What these blocks are for."');
	});

	it("--yes asks nothing: name and url are still required, version and description default", async () => {
		const ask = async () => {
			throw new Error("asked");
		};
		expect(await message(() => init({ cwd: tmp(), install: false, yes: true, ask }))).toContain("--name");
		const { root } = await init({ cwd: tmp(), ...flags, yes: true, ask });
		expect((await pkg(root)).version).toBe("0.1.0");
	});

	it("takes --version and --description, and refuses a bad version", async () => {
		const { root } = await init({ cwd: tmp(), ...flags, version: "2.0.1-beta.1", description: "Hi" });
		const p = await pkg(root);
		expect([p.version, p.description]).toEqual(["2.0.1-beta.1", "Hi"]);
		expect(await message(() => init({ cwd: tmp(), ...flags, version: "v1" }))).toContain("--version 'v1'");
	});

	it("asks again after a wrong answer, and gives up after three", async () => {
		const answers = ["Bad", "acme/ok", "https://example.com/ok", "", ""];
		const errors = spyOn(console, "error").mockImplementation(() => {});
		try {
			const { name } = await init({ cwd: tmp(), install: false, ask: async () => answers.shift() ?? "" });
			expect(name).toBe("acme/ok");
			expect(errors.mock.calls[0][0]).toContain("name");
			const never = async () => "Bad";
			expect(await message(() => init({ cwd: tmp(), install: false, ask: never }))).toContain("--name");
		} finally {
			errors.mockRestore();
		}
	});
});

describe("addToIndex", () => {
	const add = (text: string, list = "blocks") => addToIndex(text, list, "newBlock", "./blocks/new");

	it("imports it and adds it to an empty, one-line or multi-line list", () => {
		expect(add('import { plugin } from "@fluxify/sdk";\nexport default plugin({\n\tblocks: [],\n});\n')).toBe(
			'import { plugin } from "@fluxify/sdk";\nimport newBlock from "./blocks/new";\nexport default plugin({\n\tblocks: [newBlock],\n});\n',
		);
		expect(add("plugin({ blocks: [a, b] })")).toBe('import newBlock from "./blocks/new";\nplugin({ blocks: [a, b, newBlock] })');
		expect(add("plugin({\n\tblocks: [\n\t\ta,\n\t],\n})")).toContain("blocks: [\n\t\ta,\n\t\tnewBlock,\n\t],");
	});

	it("adds a list that is missing, and goes after a multi-line import", () => {
		const text = add('import {\n\tplugin,\n} from "@fluxify/sdk";\nexport default plugin({ name: "a" });\n');
		expect(text).toBe(
			'import {\n\tplugin,\n} from "@fluxify/sdk";\nimport newBlock from "./blocks/new";\nexport default plugin({\n\tblocks: [newBlock], name: "a" });\n',
		);
	});

	it("leaves a file with no plugin({ to edit", () => {
		expect(add("export default def;")).toBeUndefined();
	});
});

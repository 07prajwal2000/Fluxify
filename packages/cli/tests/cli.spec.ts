import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Glob } from "bun";
import { main } from "../src/cli";

const spies: { mockRestore(): void }[] = [];
async function run(...argv: string[]) {
	const out: string[] = [];
	spies.push(
		spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" "))),
		spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" "))),
	);
	const code = await main(argv, process.cwd());
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strips colour codes
	return { code, text: out.join("\n").replace(/\x1b\[[0-9;]*m/g, "") };
}
afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

describe("command line", () => {
	it("--help and -h list the commands, and a command's own options with short and long forms", async () => {
		const root = await run("--help");
		expect(root.code).toBe(0);
		for (const c of ["init", "build", "blocks", "integrations", "triggers"]) expect(root.text).toContain(c);
		const init = await run("init", "-h");
		expect(init.code).toBe(0);
		expect(init.text).toContain("-n, --name");
		expect(init.text).toContain("--no-install");
		expect(init.text).not.toContain("--group");
	});

	it("exits 1 with the command's help on an unknown command, option or missing argument", async () => {
		const unknown = await run("nope");
		expect(unknown.code).toBe(1);
		expect(unknown.text).toContain("Unknown command nope");
		const option = await run("build", "--forse");
		expect(option.code).toBe(1);
		expect(option.text).toContain("Unknown option --forse");
		const missing = await run("blocks", "create");
		expect(missing.code).toBe(1);
		expect(missing.text).toContain("Missing required positional argument: NAME");
	});
});

describe("version", () => {
	it("a lone --version or -v prints the CLI version; with init, -v is the plugin version", async () => {
		const { version } = await Bun.file(`${import.meta.dir}/../package.json`).json();
		for (const flag of ["--version", "-v"]) expect(await run(flag)).toEqual({ code: 0, text: version });
		expect((await run("--help")).text).toContain(`(fluxify-cli v${version})`);
		const init = await run("init", "-n", "acme/x", "-u", "https://example.com/x", "-v", "x");
		expect(init.text).toContain("--version 'x'");
	});
});

describe("the parser library", () => {
	it("is imported by src/cli/citty.ts only", async () => {
		const users: string[] = [];
		for await (const file of new Glob("src/**/*.ts").scan(`${import.meta.dir}/..`))
			if ((await Bun.file(`${import.meta.dir}/../${file}`).text()).includes('"citty"')) users.push(file.replaceAll("\\", "/"));
		expect(users).toEqual(["src/cli/citty.ts"]);
	});
});

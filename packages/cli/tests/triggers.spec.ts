import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { build } from "../src/build";
import { createTrigger } from "../src/create";
import { cleanup, failures, makePlugin } from "./helpers";

afterAll(cleanup);

/** a trigger at `src/triggers/<file>.ts` of acme/t */
const triggerSrc = (file: string, extra = "") => `import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";
export default trigger({
	name: "acme/t/${file}",
	label: "Poll",
	icon: "./icons/poll.svg",
	${extra}
	params: { topic: param.string(), every: param.number({ default: 5, tab: "Source" }) },
	start: async () => {},
	stop: async () => {},
});
`;
const ICON = { "icons/poll.svg": "<svg/>" };

describe("triggers create", () => {
	it("scaffolds a trigger that builds into a manifest the SDK accepts, and passes its test", async () => {
		const root = await makePlugin();
		const { files } = await createTrigger({ cwd: root, name: "sources/poll" });
		expect(files).toEqual(["src/triggers/sources/poll.ts", "src/triggers/sources/poll.test.ts", "icons/poll.svg"]);

		const { manifest } = await build(root);
		expect(manifest.triggers).toEqual([
			{
				entry: "dist/triggers/sources/poll.js",
				name: "acme/t/sources/poll",
				label: "poll",
				icon: "icons/poll.svg",
				permissions: {},
				params: { intervalSeconds: { type: "number", label: "Poll every (seconds)", default: 30, order: 0 } },
				retry: false,
			},
		]);
		const written = await Bun.file(join(root, "fluxify.json")).json();
		expect(fluxifyManifestSchema.safeParse(written).success).toBe(true);
		const run = Bun.spawnSync(["bun", "test", "src/triggers"], { cwd: root, env: { ...process.env, NODE_ENV: "test" } });
		expect(run.stderr.toString()).toContain("1 pass");
	}, 120_000);

	it("refuses an existing file and a bad name", async () => {
		const root = await makePlugin();
		await createTrigger({ cwd: root, name: "poll" });
		const message = (f: () => Promise<unknown>) => f().then(() => "", (e) => e.problems?.[0] ?? e.message);
		expect(await message(() => createTrigger({ cwd: root, name: "poll" }))).toContain("already exists");
		expect(await message(() => createTrigger({ cwd: root, name: "Poll" }))).toContain("is not a trigger name");
	});
});

describe("blocks build: triggers", () => {
	it("leaves triggers out of a plugin that has none", async () => {
		expect((await build(await makePlugin())).manifest.triggers).toBeUndefined();
	});

	it("fails on a module that does not default-export a trigger, and on a block-only field", async () => {
		const notOne = await makePlugin({ "src/triggers/a.ts": "export default { name: 'acme/t/a' };" });
		expect(await failures(notOne)).toEqual(["src/triggers/a.ts: must default-export a trigger(...)"]);
		const blocky = await makePlugin({ ...ICON, "src/triggers/a.ts": triggerSrc("a", 'shape: "wide",') });
		expect(await failures(blocky)).toEqual([expect.stringContaining("shape belong to a block, not a trigger")]);
	});

	it("warns on a param in a tab that tabs does not list", async () => {
		const root = await makePlugin({ ...ICON, "src/triggers/a.ts": triggerSrc("a", 'tabs: ["General"],') });
		const { warnings } = await build(root);
		expect(warnings).toContain(
			"acme/t/a: param 'every' is in a tab that tabs does not list, so it is shown after them",
		);
	});
});

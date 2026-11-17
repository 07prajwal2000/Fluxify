import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "../src/build";
import { createIntegration } from "../src/create";
import { cleanup, failures, makePlugin, tmp } from "./helpers";

afterAll(cleanup);

const SDK = { "@fluxify/sdk": ">=2026.10.2001", zod: "^4.0.0" };

/** the built plugin `other/crm` (npm `@other/crm`) with group `other/crm`, installed in `<dir>/node_modules` */
function installCrm(dir: string, manifest: object | null = crmManifest()) {
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "@other/crm", version: "1.4.0", fluxify: { name: "other/crm" } }),
		"index.d.ts": "export type CrmClient = { find(id: string): Promise<{ id: string }> };\n",
		"index.js": "export const VERSION = '1.4.0';\n",
		...(manifest && { "fluxify.json": JSON.stringify(manifest) }),
	};
	for (const [path, text] of Object.entries(files)) {
		const file = join(dir, "node_modules", "@other", "crm", path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	}
}

function crmManifest() {
	return {
		name: "other/crm",
		url: "https://example.com/other/crm",
		sdk: ">=2026.10.2001",
		blocks: {},
		integrations: [
			{
				name: "other/crm/hub",
				label: "Hub",
				icon: "icons/hub.svg",
				group: "other/crm",
				variant: "Hub",
				configSchema: {},
				secretParams: [],
				hasTest: false,
				hasDescribe: false,
				hasInspect: false,
				entry: "dist/integrations/hub.js",
			},
		],
	};
}

/** a block of acme/t using group other/crm, with `head` above it */
const useSrc = (head = 'import type { CrmClient } from "@other/crm";', variants = '["Hub"]') => `${head}
import { block, param } from "@fluxify/sdk/blocks";
export default block({
	name: "acme/t/find",
	label: "Find",
	docs: "Docs.",
	permissions: { integrations: ["other/crm"] },
	params: { crm: param.integration({ kind: "other/crm", variants: ${variants} }) },
	async run({ params, ctx }) {
		const crm = (await ctx.integrations.get(params.crm)) as CrmClient;
		return { output: await crm.find("1") };
	},
});
`;

/** acme/t in `<dir>/plugin`, peering on @other/crm, which is installed in `<dir>/node_modules` */
async function dependent(src = useSrc(), crm: object | null = crmManifest()) {
	const dir = tmp();
	installCrm(dir, crm);
	return makePlugin(
		{ "src/blocks/find.ts": src },
		{ peerDependencies: { ...SDK, "@other/crm": "^1.2.0" } },
		join(dir, "plugin"),
	);
}

describe("fluxify-cli build: plugin dependencies (#899)", () => {
	it("records the peers that are plugins, and lets a block use their groups and variants", async () => {
		const { manifest } = await build(await dependent());
		expect(manifest.dependencies).toEqual([{ name: "@other/crm", plugin: "other/crm", range: "^1.2.0" }]);
		expect(manifest.blocks["acme/t/find"]?.permissions.integrations).toEqual(["other/crm"]);
	});

	it("leaves dependencies out when no peer is a plugin", async () => {
		expect((await build(await makePlugin())).manifest.dependencies).toBeUndefined();
	});

	it("fails on a group or a variant the dependency does not declare", async () => {
		const missing = await failures(await dependent(useSrc(undefined, '["Nope"]')));
		expect(missing).toEqual([expect.stringContaining("'Nope' is not a variant of other/crm; known: Hub")]);
	});

	it("fails on a runtime import of a dependency, naming the module", async () => {
		const problems = await failures(
			await dependent(useSrc('import { VERSION } from "@other/crm";\nconsole.log(VERSION);\ntype CrmClient = any;')),
		);
		expect(problems).toEqual([
			expect.stringContaining("dist/blocks/find.js imports @other/crm at run time"),
		]);
	});

	it("fails on a peer that is a plugin but not built, or not installed", async () => {
		expect(await failures(await dependent(useSrc(), null))).toEqual([
			"peerDependency @other/crm is a Fluxify plugin with no fluxify.json: build it",
		]);
		const lonely = await makePlugin({}, { peerDependencies: { ...SDK, "@other/gone": "^1.0.0" } });
		expect(await failures(lonely)).toEqual([expect.stringContaining("peerDependency @other/gone is not installed")]);
	});

	it("without the peer, the dependency's group is refused as before", async () => {
		const root = await makePlugin({ "src/blocks/find.ts": useSrc("type CrmClient = any;") });
		expect((await failures(root)).join("\n")).toContain("add that plugin to peerDependencies");
	});

	describe("a variant of the dependency's group", () => {
		const message = (f: () => Promise<unknown>) =>
			f().then(
				() => "",
				(e) => e.problems?.[0] ?? e.message,
			);

		it("scaffolds one importing the dependency's types, and builds it into that group", async () => {
			const root = await dependent();
			const { files } = await createIntegration({ cwd: root, name: "pipe", group: "other/crm" });
			expect(files).toContain("src/integrations/pipe.ts");
			const source = await Bun.file(join(root, "src/integrations/pipe.ts")).text();
			expect(source).toContain('import type {} from "@other/crm";');
			expect(source).toContain('group: "other/crm"');
			const { manifest } = await build(root);
			expect(manifest.integrations?.map((i) => [i.group, i.variant])).toEqual([["other/crm", "pipe"]]);
		});

		it("refuses a group no dependency declares, and one of a plugin it does not depend on", async () => {
			const root = await dependent();
			expect(await message(() => createIntegration({ cwd: root, name: "a", group: "other/billing" }))).toBe(
				"plugin other/crm declares no integration group 'other/billing'",
			);
			expect(await message(() => createIntegration({ cwd: root, name: "b", group: "zzz/crm" }))).toContain(
				"group 'zzz/crm' is not a group of a plugin this one depends on",
			);
		});

		it("fails the build on a variant the dependency already provides, or a group it does not declare", async () => {
			const edited = async (from: string, to: string) => {
				const root = await dependent();
				await createIntegration({ cwd: root, name: "hub", group: "other/crm" });
				const src = join(root, "src/integrations/hub.ts");
				await Bun.write(src, (await Bun.file(src).text()).replace(from, to));
				return failures(root);
			};
			expect(await edited('variant: "hub"', 'variant: "Hub"')).toEqual([
				expect.stringContaining("variant 'Hub' of other/crm is already provided by plugin other/crm"),
			]);
			expect(await edited('group: "other/crm"', 'group: "other/billing"')).toEqual([
				expect.stringContaining("plugin other/crm declares no integration group 'other/billing' (other/crm)"),
			]);
		});
	});
});

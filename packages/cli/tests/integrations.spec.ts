import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { BUILT_IN_INTEGRATION_GROUPS } from "@fluxify/sdk/integrations";
import { build } from "../src/build";
import { createIntegration } from "../src/create";
import { cleanup, failures, makePlugin } from "./helpers";

afterAll(cleanup);

type Options = { group?: string; variant?: string; extra?: string; client?: string };

/** an integration at `src/integrations/<file>.ts` of acme/t */
const integrationSrc = (
	file: string,
	{ group = "crm", variant = "Hub", extra = "", client = "({ ping: async () => 'pong' })" }: Options = {},
) => `import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
export default integration({
	name: "acme/t/${file}",
	label: "${variant}",
	icon: "./icons/hub.svg",
	group: ${JSON.stringify(group)},
	variant: ${JSON.stringify(variant)},
	${extra}
	config: {
		region: param.select({ options: ["eu", "us"], default: "eu" }),
		token: param.secret({ label: "Token", required: true }),
	},
	connect: (config, ctx) => ${client},
	test: async () => ({ success: true }),
});
`;

const KV_CLIENT = "({ get: async () => null, set: async () => {}, setex: async () => {}, delete: async () => {} })";
const ICON = { "icons/hub.svg": "<svg/>" };

describe("blocks build: integrations", () => {
	it("writes each integration into fluxify.json, its group namespaced, and ships its module", async () => {
		const root = await makePlugin({
			...ICON,
			"src/integrations/upstash.ts": integrationSrc("upstash", { group: "kv", variant: "Upstash", client: KV_CLIENT }),
			"src/integrations/crm/hub.ts": integrationSrc("crm/hub"),
		});
		const { manifest } = await build(root);
		const common = {
			icon: "icons/hub.svg",
			configSchema: {
				region: { type: "select", options: ["eu", "us"], default: "eu", order: 0 },
				token: { type: "secret", label: "Token", required: true, order: 1 },
			},
			secretParams: ["token"],
			hasTest: true,
			hasDescribe: false,
			hasInspect: false,
		} as const;
		expect(manifest.integrations as unknown).toEqual([
			{ entry: "dist/integrations/crm/hub.js", name: "acme/t/crm/hub", label: "Hub", group: "acme/crm", variant: "Hub", ...common },
			{ entry: "dist/integrations/upstash.js", name: "acme/t/upstash", label: "Upstash", group: "kv", variant: "Upstash", ...common },
		]);
		expect(await Bun.file(join(root, "dist/integrations/crm/hub.js")).exists()).toBe(true);
		expect((await Bun.file(join(root, "fluxify.json")).json()).integrations).toEqual(manifest.integrations);
	});

	it("leaves integrations out of a plugin that has none", async () => {
		expect((await build(await makePlugin())).manifest.integrations).toBeUndefined();
	});

	it("fails on one group/variant declared twice", async () => {
		const root = await makePlugin({
			...ICON,
			"src/integrations/a.ts": integrationSrc("a"),
			"src/integrations/b.ts": integrationSrc("b", { variant: "HUB" }),
		});
		expect(await failures(root)).toEqual([
			expect.stringContaining("variant 'acme/crm/HUB' is declared twice in this plugin"),
		]);
	});

	it("fails on a local group shadowing a built-in group", async () => {
		const root = await makePlugin({ ...ICON, "src/integrations/a.ts": integrationSrc("a", { group: "KV" }) });
		expect(await failures(root)).toEqual([expect.stringContaining("shadows the built-in group 'kv'")]);
	});

	it("fails on a built-in group variant taking a built-in variant's name or dbType", async () => {
		const root = await makePlugin({
			...ICON,
			"src/integrations/a.ts": integrationSrc("a", { group: "kv", variant: "Redis", client: KV_CLIENT }),
		});
		expect(await failures(root)).toEqual([
			expect.stringContaining("variant 'Redis' is taken by a built-in kv variant"),
		]);
		const db = await makePlugin({
			...ICON,
			"src/integrations/a.ts": integrationSrc("a", {
				group: "database",
				variant: "Acme",
				extra: `extras: { conditionEditor: "sql", dbType: "mysql" },`,
				client: "({}) as any",
			}),
		});
		expect(await failures(db)).toEqual([expect.stringContaining("extras.dbType 'mysql' is taken by a built-in database")]);
	});

	it("fails on a module that does not default-export an integration", async () => {
		const root = await makePlugin({ "src/integrations/a.ts": "export default { name: 'acme/t/a' };" });
		expect(await failures(root)).toEqual(["src/integrations/a.ts: must default-export an integration(...)"]);
	});
});

describe("integrations create", () => {
	it("scaffolds one per built-in group and one of its own, and they build and pass their tests", async () => {
		const root = await makePlugin();
		const made: string[] = [];
		for (const group of BUILT_IN_INTEGRATION_GROUPS) {
			const { files } = await createIntegration({ cwd: root, name: `acme-${group}`, group });
			made.push(...files);
		}
		made.push(...(await createIntegration({ cwd: root, name: "billing/ledger" })).files);
		expect(made).toContain("src/integrations/billing/ledger.ts");
		expect(made).toContain("icons/ledger.svg");

		const { manifest } = await build(root);
		expect(manifest.integrations!.map((i) => i.group)).toEqual([
			"ai",
			"baas",
			"database",
			"kv",
			"mcp",
			"observability",
			"queue",
			"acme/ledger",
		]);
		const run = Bun.spawnSync(["bun", "test", "src/integrations"], { cwd: root, env: { ...process.env, NODE_ENV: "test" } });
		expect(run.stderr.toString()).toContain("8 pass");
	}, 120_000);

	it("refuses an existing file and a malformed group", async () => {
		const root = await makePlugin();
		await createIntegration({ cwd: root, name: "hub" });
		const message = (f: () => Promise<unknown>) => f().then(() => "", (e) => e.problems?.[0] ?? e.message);
		expect(await message(() => createIntegration({ cwd: root, name: "hub" }))).toContain("already exists");
		expect(await message(() => createIntegration({ cwd: root, name: "x", group: "Acme/crm" }))).toBe(
			"group 'Acme/crm' must be a built-in group or a lowercase name of your own",
		);
	});
});

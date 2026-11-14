// The source project the plugin backup tests (#1101) share. A helper, not a
// test file: an uploaded plugin with a block, an integration variant and a
// trigger kind, a folder plugin, an integration of the plugin's variant, a route
// whose plugin block names that integration, and a plugin trigger on a workflow.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { block, param, toManifestEntry } from "@fluxify/sdk/blocks";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";
import type { Stack } from "../../../deployments/tests/blockHarness";
import { short } from "../../../deployments/tests/blockHarness";
import { pluginFiles, pluginTgz } from "../../../plugins/sources/tests/tarball";

export const STORE = "acme/store";
export const PUT = `${STORE}/put`;
export const POLLER = `${STORE}/poller`;
/** the folder plugin `pluginFiles` describes */
export const ECHO = "acme/echo";
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";

const putBlock = block({
	name: PUT,
	label: "Put",
	permissions: { integrations: ["kv"] },
	params: { conn: param.integration({ kind: "kv" }), key: param.string({ required: true }) },
	async run() {
		return { output: null };
	},
});

const kv = toIntegrationEntry({
	name: `${STORE}/kv`,
	label: "Acme KV",
	icon: ICON,
	group: "kv",
	variant: "AcmeKV",
	config: { host: param.string({ required: true }) },
	connect: () => ({}),
} as never);

const poller = trigger({
	name: POLLER,
	label: "Poller",
	icon: ICON,
	permissions: {},
	params: { every: param.number({ default: 5 }) } as never,
	start: async () => async () => {},
});

/** the uploaded plugin's tarball */
export const storeTgz = () =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/store",
			version: "2026.10.2001",
			fluxify: { name: STORE, url: "https://github.com/acme/fluxify-store" },
		}),
		"fluxify.json": JSON.stringify({
			name: STORE,
			url: "https://github.com/acme/fluxify-store",
			sdk: ">=2026.10.0",
			blocks: { [PUT]: { ...toManifestEntry(putBlock), entry: "dist/blocks/put.js" } },
			integrations: [{ ...kv, entry: "dist/integrations/kv.js" }],
			triggers: [{ ...toTriggerEntry(poller), entry: "dist/triggers/poller.js" }],
		}),
		"dist/blocks/put.js": "export default { run: async () => ({ output: null }) };",
		"dist/integrations/kv.js": "export default {};",
		"dist/triggers/poller.js": "export default {};",
		"dist/blocks/step.js": null,
	} as never);

/** the folder plugin, written to `<root>/echo` */
export function writeEchoFolder(root: string) {
	for (const [path, data] of Object.entries(pluginFiles())) {
		mkdirSync(dirname(join(root, "echo", path)), { recursive: true });
		writeFileSync(join(root, "echo", path), data);
	}
	return "echo";
}

export type Source = Awaited<ReturnType<typeof sourceProject>>;

/** both plugins approved and on in both environments, as a creator would leave them */
export async function sourceProject(stack: Stack, pluginsDir: string) {
	const { as, project } = await stack.setup();
	const { registerArchive } = await import("../../../plugins/sources/archive");
	const { addFsPlugin } = await import("../../../plugins/sources/fs");
	await registerArchive(project, storeTgz(), "upload");
	process.env.FLUXIFY_PLUGINS_DIR = pluginsDir;
	const caller = { user: { id: as.user, isSystemAdmin: true }, acl: [] } as never;
	await addFsPlugin(project, writeEchoFolder(pluginsDir), caller);
	await stack.sql`UPDATE plugins SET approval = 'approved', approved_by = ${as.user}, approved_at = now(),
		permissions = ${JSON.stringify({ integrations: ["kv"], appconfig: false })}::text::jsonb, prod_enabled = true
		WHERE project_id = ${project}`;

	const integration = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
		VALUES (${integration}, 'acme-kv', 'kv', 'AcmeKV', ${JSON.stringify({ host: "kv.example" })}::text::jsonb, ${project})`;
	const route = await stack.createRoute(as);
	await stack.setBlock(as, "routes", route, PUT, { conn: integration, key: "k" });

	const workflow = await stack.createWorkflow(as);
	const group = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO trigger_groups (id, name, project_id, is_default) VALUES (${group}, 'default', ${project}, true)`;
	const poll = `t-${short()}`;
	await stack.sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id, source, active, dev_active)
		VALUES (${Bun.randomUUIDv7()}, ${poll}, ${`plugin:${POLLER}`}, ${project}, ${workflow}, ${group},
		${JSON.stringify({ every: 5 })}::text::jsonb, true, true)`;

	const [r] = await stack.sql`SELECT name FROM routes WHERE id = ${route}`;
	return { as, project, integration, route: r.name as string, trigger: poll };
}

import { manifestOf } from "@/components/settings/plugins/PluginSummary";
import type { Plugin, PluginManifest } from "@/services/plugins";

export type PluginBlock = PluginManifest["blocks"][string];
export type PluginBlockGroup = { key: string; plugin: Plugin; blocks: PluginBlock[] };

/** the manifest that loads: an approved plugin's own, or the approved one an upgrade still serves */
const liveManifest = (p: Plugin): PluginManifest | null =>
	p.approval === "approved" ? manifestOf(p) : p.live ? (p.live.manifest as PluginManifest) : null;

/** `acme/slack/messages/post` → `acme/slack/messages`: the plugin and the folder inside it */
const groupOf = (type: string) => type.split("/").slice(0, -1).join("/");

/**
 * The blocks of the plugins that load, grouped by plugin and folder
 * (`scope/name/folder`), the group with the most blocks first. A plugin waiting for its first approval, or rejected,
 * loads nothing, so it has no blocks here.
 */
export function pluginBlockGroups(plugins: Plugin[], search = ""): PluginBlockGroup[] {
	const q = search.trim().toLowerCase();
	const groups = new Map<string, PluginBlockGroup>();
	for (const plugin of plugins) {
		for (const block of Object.values(liveManifest(plugin)?.blocks ?? {})) {
			if (
				q &&
				![block.label, block.name, block.description ?? ""].some((v) => v.toLowerCase().includes(q))
			)
				continue;
			const key = groupOf(block.name);
			const group = groups.get(key) ?? { key, plugin, blocks: [] };
			group.blocks.push(block);
			groups.set(key, group);
		}
	}
	// most blocks first, then by name
	return [...groups.values()].sort(
		(a, b) => b.blocks.length - a.blocks.length || a.key.localeCompare(b.key),
	);
}

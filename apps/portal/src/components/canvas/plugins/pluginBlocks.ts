import type { HandleSpec, HandleSpecs } from "@fluxify/blocks/layout";
import type { Plugin, PluginManifest } from "@/services/plugins";

/** a block as the plugin manifest holds it: shape, icon, params, handles, deprecation */
export type PluginManifestBlock = PluginManifest["blocks"][string];

export type PluginBlockDef = {
	/** `scope/name/folder/block`: the block type on the canvas */
	type: string;
	/** `scope/name` of the plugin it belongs to */
	plugin: string;
	/** the plugin's homepage, for the Docs tab */
	url: string;
	/** the plugin's own icon and its scope's (data URLs), for the picker's folders */
	pluginIcon?: string;
	scopeIcon?: string;
	/** when the plugin was approved: the latest approved one's scope icon wins */
	approvedAt: string | null;
	label: string;
	description?: string;
	shape: "square" | "wide";
	handles: HandleSpec;
	/** the message of a deprecated block */
	deprecated: string | null;
	invoke: string[];
	/** the manifest entry, for what only the renderers read (icon, docs) */
	entry: PluginManifestBlock;
	/** the plugin is approved (or an approved version still serves an upgrade), so a new block of it can run */
	loads: boolean;
};

/** plugin types are `scope/name/.../block`; built-in and custom block names never hold a `/` */
export const isPluginType = (type: string | null | undefined) => !!type?.includes("/");

/**
 * The blocks a canvas may hold, as the server's canvas rule reads them: any
 * plugin not rejected, as the version that loads (an upgrade's handles arrive
 * with its approval). A block of a plugin still waiting for its first approval
 * can be wired and drawn, but `loads` is false, so the picker does not offer it.
 */
export function pluginBlockDefs(plugins: Plugin[]): PluginBlockDef[] {
	return plugins.flatMap((plugin) => {
		if (plugin.approval === "rejected") return [];
		const upgrade = plugin.approval === "pending" ? plugin.live : null;
		const manifest = (upgrade?.manifest ?? plugin.manifest) as unknown as PluginManifest;
		const loads = plugin.approval === "approved" || upgrade !== null;
		return Object.values(manifest.blocks).map((entry) => ({
			type: entry.name,
			plugin: plugin.name,
			url: plugin.url,
			pluginIcon: manifest.icon,
			scopeIcon: manifest.scopeIcon,
			approvedAt: plugin.approvedAt,
			label: entry.label,
			description: entry.description,
			shape: entry.shape,
			handles: entry.handles as HandleSpec,
			deprecated: entry.deprecated,
			invoke: entry.invoke,
			entry,
			loads,
		}));
	});
}

export const pluginHandleSpecs = (defs: PluginBlockDef[]): HandleSpecs =>
	Object.fromEntries(defs.map((def) => [def.type, def.handles]));

/** what a search matches: the label and the path, which carries the plugin and its folders */
export const pluginSearchText = (def: PluginBlockDef) =>
	[def.type, def.label, def.description ?? ""].join(" ").toLowerCase();

/** deprecated blocks last, each group by label */
export const byDeprecationThenLabel = (a: PluginBlockDef, b: PluginBlockDef) =>
	Number(a.deprecated !== null) - Number(b.deprecated !== null) || a.label.localeCompare(b.label);

/** how deep a folder sits: the scope, the plugin, or a folder inside the plugin */
export type PluginFolderLevel = "scope" | "plugin" | "folder";

export type PluginRow =
	| { kind: "folder"; path: string; name: string; level: PluginFolderLevel; blocks: number }
	| { kind: "block"; def: PluginBlockDef };

/**
 * What one level of the `Plugins` tree holds: `""` is the scopes, `acme` its
 * plugins, `acme/slack` their folders and blocks. Folders first by name, then
 * blocks with the deprecated ones last.
 */
export function pluginRows(defs: PluginBlockDef[], path: string): PluginRow[] {
	const depth = path ? path.split("/").length : 0;
	const folders = new Map<string, Extract<PluginRow, { kind: "folder" }>>();
	const blocks: PluginBlockDef[] = [];
	for (const def of defs) {
		if (path && !def.type.startsWith(`${path}/`)) continue;
		const segments = def.type.split("/");
		if (segments.length === depth + 1) {
			blocks.push(def);
			continue;
		}
		const name = segments[depth]!;
		const folderPath = segments.slice(0, depth + 1).join("/");
		const known = folders.get(folderPath);
		if (known) known.blocks++;
		else
			folders.set(folderPath, {
				kind: "folder",
				path: folderPath,
				name,
				level: depth === 0 ? "scope" : depth === 1 ? "plugin" : "folder",
				blocks: 1,
			});
	}
	return [
		...[...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
		...blocks.sort(byDeprecationThenLabel).map((def) => ({ kind: "block" as const, def })),
	];
}

/** `acme/slack` → `[acme, acme/slack]`: the folders to walk to reach a path, for the back button and the title */
export const pathTrail = (path: string) =>
	path
		.split("/")
		.filter(Boolean)
		.map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** The data a new plugin block starts with: an invocation mode its manifest allows, `sync` when it does. */
export const pluginBlockData = (def: PluginBlockDef) => ({
	invoke: def.invoke.includes("sync") ? "sync" : def.invoke[0],
});

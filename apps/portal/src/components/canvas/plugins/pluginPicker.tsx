import type { ReactNode } from "react";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { pluginBlockIcon } from "@/components/settings/plugins/pluginBlockIcon";
import { type PluginBlockDef, type PluginRow, pluginRows } from "./pluginBlocks";
import { pluginFolderIcon } from "./pluginFolderIcon";

/** What the picker lists: a block to add, or (with `folder`) a folder of the `Plugins` tree to open. */
export type PluginPickerItem = {
	type: string;
	name: string;
	description: string;
	category: "Plugins";
	icon: ReactNode;
	/** set on a folder: the path to open */
	folder?: string;
	/** a plugin block's full path, which a search shows to tell same-named blocks apart */
	path?: string;
	/** the message of a deprecated block */
	deprecated?: string;
};

export const pluginItem = (def: PluginBlockDef): PluginPickerItem => ({
	type: def.type,
	name: def.label,
	description: def.description ?? def.type,
	category: "Plugins",
	icon: <CustomBlockIcon {...pluginBlockIcon(def.entry)} />,
	path: def.type,
	deprecated: def.deprecated ?? undefined,
});

const itemOf = (row: PluginRow): PluginPickerItem =>
	row.kind === "block"
		? pluginItem(row.def)
		: {
				type: `folder:${row.path}`,
				name: row.name,
				description: `${row.blocks} ${row.blocks === 1 ? "block" : "blocks"}`,
				category: "Plugins",
				icon: pluginFolderIcon(row),
				folder: row.path,
			};

/** One level of the tree: `""` is the scopes, then `acme`, `acme/slack`, … */
export const pluginFolderItems = (defs: PluginBlockDef[], path: string) =>
	pluginRows(defs, path).map(itemOf);

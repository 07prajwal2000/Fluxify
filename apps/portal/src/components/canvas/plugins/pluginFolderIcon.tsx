import type { ReactNode } from "react";
import { TbFolder, TbPackage, TbPlug } from "react-icons/tb";
import type { PluginFolderLevel } from "./pluginBlocks";

/**
 * The icon of a folder in the picker's `Plugins` tree. The only place that
 * decides it, so a plugin can later bring its own without touching the tree.
 */
export function pluginFolderIcon(folder: { level: PluginFolderLevel; path: string }): ReactNode {
	if (folder.level === "scope") return <TbPlug />;
	if (folder.level === "plugin") return <TbPackage />;
	return <TbFolder />;
}

import type { ReactNode } from "react";
import { TbFolder, TbPackage, TbPlug } from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import type { PluginBlockDef, PluginFolderLevel } from "./pluginBlocks";

/**
 * The icon a scope's folder shows: its plugins' `scopeIcon`, and when they
 * disagree, the most recently approved plugin's; none when no plugin sets one.
 */
export function scopeIconOf(defs: PluginBlockDef[], scope: string): string | undefined {
	const latest = defs
		.filter((def) => def.scopeIcon && def.plugin.startsWith(`${scope}/`))
		.sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""))[0];
	return latest?.scopeIcon;
}

const image = (url: string | undefined, fallback: ReactNode) =>
	url ? <CustomBlockIcon icon="custom" iconUrl={url} /> : fallback;

/**
 * The icon of a folder in the picker's `Plugins` tree: the plugin's own icon
 * for a plugin, the scope icon for a scope, the defaults otherwise. The only
 * place that decides it.
 */
export function pluginFolderIcon(
	folder: { level: PluginFolderLevel; path: string },
	defs: PluginBlockDef[] = [],
): ReactNode {
	if (folder.level === "scope") return image(scopeIconOf(defs, folder.path), <TbPlug />);
	if (folder.level === "plugin")
		return image(defs.find((def) => def.plugin === folder.path)?.pluginIcon, <TbPackage />);
	return <TbFolder />;
}

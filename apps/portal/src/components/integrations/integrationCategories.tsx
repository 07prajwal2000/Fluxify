import type { ReactNode } from "react";
import { TbPlug } from "react-icons/tb";
import { pluginFolderIcon } from "@/components/canvas/plugins/pluginFolderIcon";
import { GROUP_DETAILS } from "./groupDetails";

export const ALL_CATEGORIES = "all";

export type IntegrationCategory = { group: string; label: string; icon: ReactNode };

type CatalogGroup = { group: string; label: string };

/** the group's icon: a built-in's own, else the plugin folder's, else a plug */
export function groupIcon(group: string): ReactNode {
	return (
		GROUP_DETAILS[group]?.icon ?? pluginFolderIcon({ level: "plugin", path: group }) ?? <TbPlug />
	);
}

/**
 * Every category the page can filter by: the catalog's groups (built-ins first,
 * then plugins'), plus any group an existing integration uses that the catalog
 * no longer offers (a disabled plugin).
 */
export function buildCategories(
	catalog: CatalogGroup[],
	integrations: { group: string }[],
	selected?: string,
): IntegrationCategory[] {
	const seen = new Set<string>();
	const out: IntegrationCategory[] = [];
	const add = (group: string, label = group) => {
		if (seen.has(group)) return;
		seen.add(group);
		out.push({ group, label, icon: groupIcon(group) });
	};
	for (const g of catalog) add(g.group, g.label);
	for (const i of integrations) add(i.group);
	if (selected && selected !== ALL_CATEGORIES) add(selected);
	return out;
}

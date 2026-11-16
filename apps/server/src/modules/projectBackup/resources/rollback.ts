import { CUSTOM_BLOCK_NAME_PREFIX } from "@fluxify/lib";
import type { BackupHistory } from "../../versions/backup";
import type { Use } from "../types";
import { pluginOf } from "./canvas";
import { type IntegrationTable, remapIntegrations } from "./integrationRefs";

/** What the modules share to roll back in place (#1130). */

/** name → id, the oldest first should a name repeat (names are unique per project, but not by constraint) */
export function byName(rows: { id: string; name: string | null }[]) {
	const found = new Map<string, string>();
	for (const { id, name } of rows) if (name && !found.has(name)) found.set(name, id);
	return found;
}

/** the custom blocks and plugins what runs now, or in production, calls */
export function canvasUses(owner: string, history: BackupHistory): Use[] {
	const prod = history.versions.find((v) => v.number === history.prod)?.snapshot;
	const uses = new Map<string, Use>();
	for (const snapshot of [history.working, ...(prod ? [prod] : [])])
		for (const { type } of snapshot.blocks) {
			const plugin = pluginOf(type);
			if (type.startsWith(CUSTOM_BLOCK_NAME_PREFIX))
				uses.set(`c${type}`, { owner, section: "customBlocks", name: type });
			else if (plugin) uses.set(`p${plugin}`, { owner, section: "plugins", name: plugin });
		}
	return [...uses.values()];
}

/** the integrations `value` holds, by the name the section's table gives each */
export function integrationUses(owner: string, value: unknown, table: IntegrationTable): Use[] {
	const names = new Set<string>();
	remapIntegrations(value, (v) => {
		if (Object.hasOwn(table, v) && table[v]) names.add(table[v]!);
		return undefined;
	});
	return [...names].map((name) => ({ owner, section: "integrations", name }));
}

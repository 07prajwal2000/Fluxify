import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import type { DbTransactionType } from "../../db";
import { pluginTriggerType } from "../triggers/types";
import { isUsableIn, liveOf } from "./meta";
import { listPluginRows } from "./repository";
import { dataIcon } from "./sources/icons";

/**
 * Plugin trigger kinds as admin metadata (T2): read from the approved manifest,
 * never from plugin code. A kind is the trigger's manifest `name`
 * (`acme/pg/poller`); its rows have type `plugin:<kind>`.
 */

/** the approved plugin of the project that provides trigger `kind`, as the version that loads */
export async function findTriggerKind(projectId: string, kind: string, tx?: DbTransactionType) {
	for (const row of (await listPluginRows(projectId, tx)).map(liveOf)) {
		if (row.approval !== "approved" || !kind.startsWith(`${row.name}/`)) continue;
		const entry = row.manifest.triggers?.find((t) => t.name === kind);
		if (entry) return { row, entry };
	}
	return undefined;
}

/** a manifest's trigger kinds as the approval page shows them */
export const triggerKindsOf = (manifest: FluxifyManifest) =>
	(manifest.triggers ?? []).map((t) => ({
		kind: t.name,
		type: pluginTriggerType(t.name),
		label: t.label,
		description: t.description,
		permissions: t.permissions,
		retry: t.retry,
		secretParams: Object.keys(t.params).filter((k) => t.params[k]!.type === "secret"),
	}));

/**
 * The trigger kinds a project can create (T4's wizard): every kind of an
 * approved plugin enabled in at least one environment, with its params and tabs.
 */
export async function usableTriggerKinds(projectId: string, kind?: string) {
	const kinds = [];
	for (const row of (await listPluginRows(projectId)).map(liveOf)) {
		const environments = {
			development: isUsableIn(row, "development"),
			production: isUsableIn(row, "production"),
		};
		if (!environments.development && !environments.production) continue;
		for (const t of row.manifest.triggers ?? []) {
			if (kind && t.name !== kind) continue;
			kinds.push({
				kind: t.name,
				type: pluginTriggerType(t.name),
				plugin: row.name,
				version: row.version,
				label: t.label,
				description: t.description,
				icon: dataIcon(t.icon),
				params: t.params,
				tabs: t.tabs,
				permissions: t.permissions,
				retry: t.retry,
				environments,
			});
		}
	}
	return kinds;
}

import type { BlockMeta, HandleSpec } from "@fluxify/blocks";
import type { FluxifyManifest, ManifestEntry } from "@fluxify/sdk/blocks";
import type { PluginLiveVersion, PluginPermissions } from "../../db/schema";
import type { FluxifyEnv } from "../../lib/env";

/**
 * Plugin metadata as plain data (#857). Everything here reads the manifest;
 * nothing imports plugin code, which never runs on admin.
 */

export type PluginRow = {
	name: string;
	version: string;
	integrity: string;
	approval: "pending" | "approved" | "rejected";
	devEnabled: boolean;
	prodEnabled: boolean;
	manifest: FluxifyManifest;
	live?: PluginLiveVersion | null;
};

/**
 * The version that loads (#860): the row itself, or, while an upgrade of an
 * approved plugin waits for approval, the approved version it would replace.
 * Dev and prod move together, so both keep the old one until the new is approved.
 */
export const liveOf = <R extends PluginRow>(row: R): R =>
	row.approval === "pending" && row.live ? { ...row, ...row.live, approval: "approved" } : row;

/** what the compiler and the worker need to call one block */
export const blockMetaOf = (entry: ManifestEntry): BlockMeta => {
	const ofType = (type: string) =>
		Object.keys(entry.params).filter((k) => entry.params[k]!.type === type);
	const schemaParams = ofType("schema");
	const fieldMapParams = ofType("fieldMap");
	return {
		handles: entry.handles as HandleSpec,
		invoke: entry.invoke,
		...(schemaParams.length ? { schemaParams } : {}),
		...(fieldMapParams.length ? { fieldMapParams } : {}),
	};
};

/** every block's permissions together: approval is per plugin */
export function requestedPermissions(manifest: FluxifyManifest): PluginPermissions {
	const integrations = new Set<string>();
	let appconfig = false;
	for (const block of Object.values(manifest.blocks)) {
		for (const kind of block.permissions.integrations ?? []) integrations.add(kind);
		appconfig ||= block.permissions.appconfig === true;
	}
	return { integrations: [...integrations].sort(), appconfig };
}

/** approved, and switched on for `env`: the only state in which a plugin loads */
export const isUsableIn = (row: PluginRow, env: FluxifyEnv) =>
	row.approval === "approved" && (env === "development" ? row.devEnabled : row.prodEnabled);

/** why a plugin's blocks cannot compile in `env`, or undefined when they can */
export function unusableReason(row: PluginRow, env: FluxifyEnv) {
	if (isUsableIn(row, env)) return;
	const plugin = `plugin ${row.name}@${row.version}`;
	if (row.approval === "pending") return `${plugin} is waiting for a creator to approve it`;
	if (row.approval === "rejected") return `${plugin} was rejected`;
	return `${plugin} is not enabled in ${env}`;
}

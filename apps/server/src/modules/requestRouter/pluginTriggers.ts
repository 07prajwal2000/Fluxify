import { resolve } from "node:path";
import type { PluginPermissions } from "../../db/schema";
import type { PluginArtifact } from "../compiler/artifacts";

/**
 * Where one plugin trigger kind's code is on this node (T2). Plain data, like a
 * `PluginBlockRef`: the supervisor hands these to the execution process, which
 * keeps them for the trigger runtime (T3). Nothing here imports the module or
 * calls its `start`.
 */
export type PluginTriggerRef = {
	projectId: string;
	/** e.g. "acme/pg" */
	plugin: string;
	/** part of `entry`'s path, so an upgrade imports fresh code */
	version: string;
	/** the plugin archive's hash: a trigger artifact's `plugin.integrity` must match it */
	integrity: string;
	/** the trigger's manifest name, e.g. "acme/pg/poller"; its rows are `plugin:<kind>` */
	kind: string;
	/** absolute path to the built module under `pluginDir(...)` */
	entry: string;
	/** what the plugin's approval granted */
	permissions: PluginPermissions;
};

export const pluginTriggerRefs = (artifact: PluginArtifact, root: string): PluginTriggerRef[] =>
	(artifact.triggers ?? []).map((t) => ({
		projectId: artifact.projectId,
		plugin: artifact.name,
		version: artifact.version,
		integrity: artifact.integrity,
		kind: t.name,
		entry: resolve(root, t.entry),
		permissions: artifact.permissions,
	}));

/** what decides a ref's slot: one per project and kind */
export const triggerRefKey = (ref: Pick<PluginTriggerRef, "projectId" | "kind">) =>
	`${ref.projectId}:trigger:${ref.kind}`;

/** what each `triggerRefKey` resolves to, as the supervisor last said */
const refs = new Map<string, PluginTriggerRef>();

export function setPluginTriggerRefs(list: PluginTriggerRef[] = []) {
	refs.clear();
	for (const ref of list) refs.set(triggerRefKey(ref), ref);
}

/** where the code of a plugin trigger artifact's kind is on this node, if installed */
export const pluginTriggerRef = (projectId: string, kind: string) =>
	refs.get(triggerRefKey({ projectId, kind }));

import { CUSTOM_BLOCK_NAME_PREFIX } from "@fluxify/lib";
import { BadRequestError } from "../../../errors/badRequestError";
import type { SuiteRefs } from "../../routeTransfer/suites";
import type { BackupHistory } from "../../versions/backup";
import type { IdMap } from "../types";
import type { Place } from "./integrationRefs";

/**
 * What the canvas modules (routes #1097, workflows #1098) share on restore.
 * `owner` names the resource in a refusal, e.g. `Route "orders"`.
 */

/**
 * What runs now and in production must call only custom blocks the backup
 * restores. An older version is copied as it is: it only runs again if someone
 * checks it out, and the canvas save checks it then.
 */
export function assertCustomBlocks(ids: IdMap, owner: string, history: BackupHistory) {
	const prod = history.versions.find((v) => v.number === history.prod)?.snapshot;
	for (const snapshot of [history.working, ...(prod ? [prod] : [])]) {
		for (const { type } of snapshot.blocks) {
			if (type.startsWith(CUSTOM_BLOCK_NAME_PREFIX) && !ids.get("customBlocks", type))
				throw new BadRequestError(
					`${owner} calls the custom block "${type}", which isn't in this backup.`,
				);
		}
	}
}

/** what a blanked integration does to a canvas block, for the `inspect` warnings */
export const BLANK_BLOCK =
	"They are left blank: the project still compiles, but each of those blocks fails when it runs until you pick an integration for it.";

/** inspect: each block that runs now or in production, by key, for `lostWarnings` */
export function canvasPlaces(history: BackupHistory): Place[] {
	const prod = history.versions.find((v) => v.number === history.prod)?.snapshot;
	const blocks = new Map<string, unknown[]>();
	for (const snapshot of [history.working, ...(prod ? [prod] : [])])
		for (const { key, data } of snapshot.blocks)
			blocks.set(key, [...(blocks.get(key) ?? []), data]);
	return [...blocks].map(([key, data]) => ({ where: `block ${key}`, value: data }));
}

/** plugin block types are `<scope>/<name>/<block>` and trigger kinds `plugin:<scope>/<name>/<kind>` */
const pluginOf = (type: string) => {
	const parts = type.replace(/^plugin:/, "").split("/");
	return parts.length > 2 ? parts.slice(0, 2).join("/") : undefined;
};

/** inspect: each plugin block that runs now or in production, by key */
export function pluginPlaces(history: BackupHistory) {
	const prod = history.versions.find((v) => v.number === history.prod)?.snapshot;
	const places = new Map<string, string>();
	for (const snapshot of [history.working, ...(prod ? [prod] : [])])
		for (const { key, type } of snapshot.blocks) places.set(`block ${key}`, type);
	return [...places].map(([where, type]) => ({ where, type }));
}

/**
 * inspect: one warning per resource that uses plugins the backup doesn't
 * restore (its plugins section left out, or the plugin not in it), naming each
 * plugin and where it is used. The resource restores as it is regardless.
 */
export function missingPluginWarnings(
	owner: string,
	places: { where: string; type: string }[],
	read: (section: string) => unknown,
	consequence: string,
): string[] {
	const section = read("plugins") as { plugins: { name: string }[] } | undefined;
	const have = new Set(section?.plugins.map((p) => p.name));
	const lost = new Map<string, string[]>();
	for (const { where, type } of places) {
		const plugin = pluginOf(type);
		if (plugin && !have.has(plugin)) lost.set(plugin, [...(lost.get(plugin) ?? []), where]);
	}
	if (!lost.size) return [];
	const parts = [...lost].map(([plugin, where]) => `"${plugin}" (${where.join(", ")})`);
	return [`${owner} uses plugins this backup doesn't restore: ${parts.join("; ")}. ${consequence}`];
}

/** what a canvas block of a missing plugin does after a restore */
export const MISSING_PLUGIN_BLOCK =
	"Those blocks are restored as they are, but they won't compile until you install and approve the plugin.";

/**
 * Suite references in a backup: setup, teardown and loader blocks by name, and
 * refused when missing; hooks on the restored working copy's (fresh) block ids.
 */
export function suiteRefs(ids: IdMap, owner: string, history: BackupHistory): SuiteRefs {
	const canvas = new Set(history.working.blocks.map((b) => b.id));
	return {
		block(name, role, suite) {
			const id = ids.get("customBlocks", name);
			if (!id)
				throw new BadRequestError(
					`${owner}, test "${suite}": the ${role} block "${name}" isn't in this backup.`,
				);
			return id;
		},
		// already this project's ids (`remapIntegrations`); a blanked one drops the override
		integration: (o) =>
			o.existing && o.replacement ? { existingId: o.existing, newId: o.replacement } : null,
		canvasBlock: (id) => (canvas.has(id) ? id : undefined),
		warn: () => {},
	};
}

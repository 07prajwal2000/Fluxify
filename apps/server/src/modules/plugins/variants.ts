import { type IntegrationRegistry, integrationRegistry } from "@fluxify/adapters/integrations";
import { logger } from "@fluxify/common";
import { manifestVariantMeta } from "@fluxify/sdk/runtime";
import { db } from "../../db";
import { watchArtifacts } from "../../db/natsKv";
import { pluginsEntity } from "../../db/schema";
import type { FluxifyEnv } from "../../lib/env";
import { ENVIRONMENTS } from "../../lib/envValues";
import { liveOf, type PluginRow } from "./meta";
import { getPluginRow, listPluginRows } from "./repository";

/**
 * The admin's half of plugin integrations (I6): each approved plugin's variants,
 * registered for its project as metadata only, from the approved manifest. No
 * plugin code is imported here (decision 8): the metadata is what create and
 * update validate against, what the compiler resolves rows with, what the
 * variants list shows, and what sends an op to a worker (it is not a built-in).
 *
 * The plugin row is the source of truth; it is the only thing that knows a
 * plugin approved but switched off everywhere. Admin replicas learn of a change
 * from the plugin artifacts' KV watch, and the compiler syncs a project again
 * before it builds, so a compile on another replica never races the watch.
 */

type Applied = {
	kinds: { group: string; variant: string }[];
	devEnabled: boolean;
	prodEnabled: boolean;
	version: string;
};

/** `projectId\0name` -> what is registered for that plugin */
const applied = new Map<string, Applied>();
const pluginOf = (projectId: string, name: string) => `${projectId}\u0000${name}`;

/**
 * Registers `row`'s variants for its project, replacing what the plugin had.
 * Undefined (removed) or not approved: they all go. One that another plugin of
 * the project already registered is skipped and logged: approval refuses that.
 */
export function applyPluginVariants(
	projectId: string,
	name: string,
	stored: (PluginRow & { projectId?: string }) | undefined,
	registry: IntegrationRegistry = integrationRegistry,
) {
	const key = pluginOf(projectId, name);
	const row = stored && liveOf(stored);
	const next = row?.approval === "approved" ? (row.manifest.integrations ?? []) : [];
	const before = applied.get(key);
	for (const kind of before?.kinds ?? []) registry.unregister(kind.group, kind.variant, projectId);
	applied.delete(key);
	if (!row || !next.length) return;
	const kinds: Applied["kinds"] = [];
	for (const entry of next) {
		try {
			registry.register(manifestVariantMeta(entry, name), projectId);
			kinds.push({ group: entry.group, variant: entry.variant });
		} catch (error) {
			logger.error(
				`plugin ${name} for ${projectId}: ${entry.group}/${entry.variant} not registered: ${(error as Error).message}`,
				"PLUGINS",
			);
		}
	}
	applied.set(key, {
		kinds,
		devEnabled: row.devEnabled,
		prodEnabled: row.prodEnabled,
		version: row.version,
	});
}

export async function syncPluginVariants(projectId: string, name: string) {
	applyPluginVariants(projectId, name, await getPluginRow(projectId, name));
}

/** the project's plugins as the rows hold them now, including ones this replica never saw */
export async function syncProjectPluginVariants(projectId: string) {
	const rows = await listPluginRows(projectId);
	const names = new Set(rows.map((r) => r.name));
	for (const key of applied.keys()) {
		const [owner, name] = key.split("\u0000") as [string, string];
		if (owner === projectId && !names.has(name)) applyPluginVariants(projectId, name, undefined);
	}
	for (const row of rows) applyPluginVariants(projectId, row.name, row);
}

/** which plugin of the project provides `group/variant`, with its state; undefined for anything else */
export function pluginVariantState(projectId: string, group: string, variant: string) {
	for (const [key, state] of applied) {
		const [owner, plugin] = key.split("\u0000") as [string, string];
		if (owner !== projectId) continue;
		if (state.kinds.some((k) => k.group === group && k.variant === variant))
			return { plugin, ...state };
	}
	return undefined;
}

/** a plugin variant switched off in both environments: hidden from the variants list and from create */
export function isPluginVariantDisabled(projectId: string, group: string, variant: string) {
	const state = pluginVariantState(projectId, group, variant);
	return !!state && !state.devEnabled && !state.prodEnabled;
}

/** why an integration of a plugin's kind cannot run in `env`, or undefined when it can */
export function pluginVariantUnusable(
	projectId: string,
	group: string,
	variant: string,
	env: FluxifyEnv,
) {
	const state = pluginVariantState(projectId, group, variant);
	if (!state) return undefined;
	const on = env === "development" ? state.devEnabled : state.prodEnabled;
	if (on) return undefined;
	return !state.devEnabled && !state.prodEnabled
		? `plugin ${state.plugin} is disabled`
		: `plugin ${state.plugin} is disabled in ${env}`;
}

/**
 * Registers every project's plugin variants, then follows changes. Called once
 * at admin startup, before the integrations load: a row of a plugin kind
 * resolves only once its variant is registered.
 */
export async function startPluginVariants() {
	for (const row of await db.select().from(pluginsEntity))
		applyPluginVariants(row.projectId, row.name, row);
	// any change to what a plugin publishes passes through its artifact, in one environment or both
	for (const env of ENVIRONMENTS)
		await watchArtifacts<unknown>(
			"plugin.>",
			(key) => {
				const [, projectId, ...name] = key.split(".");
				if (!projectId || !name.length) return;
				return syncPluginVariants(projectId, name.join(".")).catch((error) =>
					logger.error(`plugin variants for ${key}: ${String(error)}`, "PLUGINS"),
				);
			},
			{ env },
		);
}

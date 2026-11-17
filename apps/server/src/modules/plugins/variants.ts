import { type IntegrationRegistry, integrationRegistry } from "@fluxify/adapters/integrations";
import { logger } from "@fluxify/common";
import { manifestVariantMeta } from "@fluxify/sdk/runtime";
import { db } from "../../db";
import { watchArtifacts } from "../../db/natsKv";
import { pluginsEntity } from "../../db/schema";
import type { FluxifyEnv } from "../../lib/env";
import { ENVIRONMENTS } from "../../lib/envValues";
import { withDependencyGate } from "./dependencies";
import { isUsableIn, liveOf, type PluginRow } from "./meta";
import { listPluginRows } from "./repository";

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
	/** why a dependency stops it, per environment (#899) */
	blocked?: PluginRow["blocked"];
};

/** `projectId\0name` -> what is registered for that plugin */
const applied = new Map<string, Applied>();
const pluginOf = (projectId: string, name: string) => `${projectId}\u0000${name}`;

/**
 * Registers `row`'s variants for its project, replacing what the plugin had,
 * including those it adds to a dependency's group (#899), tagged with it.
 * Undefined (removed), not approved, or blocked by a dependency in every
 * environment it is on (`withDependencyGate`): they all go. One that another
 * plugin of the project already registered is skipped and logged: approval
 * refuses that.
 */
export function applyPluginVariants(
	projectId: string,
	name: string,
	stored: (PluginRow & { projectId?: string }) | undefined,
	registry: IntegrationRegistry = integrationRegistry,
) {
	const key = pluginOf(projectId, name);
	const row = stored && liveOf(stored);
	const stopped = !!row?.blocked && !ENVIRONMENTS.some((env) => isUsableIn(row, env));
	const next = row?.approval === "approved" && !stopped ? (row.manifest.integrations ?? []) : [];
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
		...(row.blocked && { blocked: row.blocked }),
	});
}

/**
 * The project's plugins as `rows` hold them, including ones this replica never
 * saw. Always the whole project: a plugin's variants follow its dependencies'
 * state, so a change to one re-applies its dependents (#899).
 */
export function applyProjectPluginVariants(projectId: string, rows: readonly PluginRow[]) {
	const names = new Set(rows.map((r) => r.name));
	for (const key of applied.keys()) {
		const [owner, name] = key.split("\u0000") as [string, string];
		if (owner === projectId && !names.has(name)) applyPluginVariants(projectId, name, undefined);
	}
	for (const row of withDependencyGate(rows)) applyPluginVariants(projectId, row.name, row);
}

export const syncProjectPluginVariants = async (projectId: string) =>
	applyProjectPluginVariants(projectId, await listPluginRows(projectId));

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
	if (on && state.blocked?.[env])
		return `plugin ${state.plugin} cannot load: ${state.blocked[env]}`;
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
	const rows = await db.select().from(pluginsEntity);
	for (const projectId of new Set(rows.map((r) => r.projectId)))
		applyProjectPluginVariants(
			projectId,
			rows.filter((r) => r.projectId === projectId),
		);
	// any change to what a plugin publishes passes through its artifact, in one environment or both
	for (const env of ENVIRONMENTS)
		await watchArtifacts<unknown>(
			"plugin.>",
			(key) => {
				const [, projectId, ...name] = key.split(".");
				if (!projectId || !name.length) return;
				return syncProjectPluginVariants(projectId).catch((error) =>
					logger.error(`plugin variants for ${key}: ${String(error)}`, "PLUGINS"),
				);
			},
			{ env },
		);
}

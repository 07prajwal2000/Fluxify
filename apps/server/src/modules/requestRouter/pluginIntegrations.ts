import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type IntegrationRegistry, integrationRegistry } from "@fluxify/adapters/integrations";
import { logger } from "@fluxify/common";
import type { AnyIntegration } from "@fluxify/sdk/integrations";
import { toVariantDef } from "@fluxify/sdk/runtime";
import type { PluginArtifact } from "../compiler/artifacts";
import { provideHostPackages } from "./hostPackages";

/**
 * Where one plugin integration variant's code is on this node (I6). Plain data,
 * like a `PluginBlockRef`: the supervisor hands these to the execution process
 * and to the isolated op child, and never imports one itself.
 */
export type PluginIntegrationRef = {
	projectId: string;
	/** e.g. "acme/slack" */
	plugin: string;
	/** part of `entry`'s path, so an upgrade imports fresh code */
	version: string;
	/** namespaced for a plugin's own group (`acme/crm`) */
	group: string;
	variant: string;
	/** the approved manifest's icon (a data URL); the module's own `icon` is a path and never used */
	icon: string;
	/** absolute path to the built module under `pluginDir(...)` */
	entry: string;
};

export const pluginIntegrationRefs = (
	artifact: PluginArtifact,
	root: string,
): PluginIntegrationRef[] =>
	(artifact.integrations ?? []).map((i) => ({
		projectId: artifact.projectId,
		plugin: artifact.name,
		version: artifact.version,
		group: i.group,
		variant: i.variant,
		icon: i.icon,
		entry: resolve(root, i.entry),
	}));

/** what decides a ref's slot: one per project and kind */
export const integrationRefKey = (
	ref: Pick<PluginIntegrationRef, "projectId" | "group" | "variant">,
) => `${ref.projectId}:integration:${ref.group}/${ref.variant}`;

const label = (ref: PluginIntegrationRef) =>
	`plugin ${ref.plugin}@${ref.version} integration ${ref.group}/${ref.variant}`;

/**
 * Imports one ref's module as the registry definition. The module has to be
 * the kind the approved manifest names: code that registers another kind than
 * the one a creator approved is refused.
 */
export async function importIntegration(ref: PluginIntegrationRef) {
	provideHostPackages();
	const entryPath = resolve(ref.entry);
	try {
		const mod = (await import(pathToFileURL(entryPath).href))?.default as
			| AnyIntegration
			| undefined;
		if (typeof mod?.connect !== "function")
			throw new Error("its default export is not an integration(...)");
		const def = toVariantDef(mod, { plugin: ref.plugin });
		if (def.group !== ref.group || def.variant !== ref.variant)
			throw new Error(`it defines ${def.group}/${def.variant}, not the approved one`);
		// what the creator approved, not the module's raw path
		return { ...def, icon: ref.icon };
	} catch (error) {
		throw new Error(`${label(ref)} failed to load from ${entryPath}: ${(error as Error).message}`);
	}
}

/** imported and registered in this process, by `integrationRefKey`, with their version */
const loaded = new Map<string, string>();

/**
 * Makes this process's registry hold exactly `refs`' plugin variants, each for
 * its own project. A new one is imported and registered; one no longer listed
 * is unregistered. ESM cannot be unloaded, so a version change never reaches
 * here: the supervisor replaces the process instead (`pluginRefsChanged`), and
 * a mismatch is reported, not loaded.
 */
export async function loadPluginIntegrations(
	refs: PluginIntegrationRef[] = [],
	registry: IntegrationRegistry = integrationRegistry,
) {
	provideHostPackages();
	const wanted = new Map(refs.map((ref) => [integrationRefKey(ref), ref]));
	for (const [key, version] of loaded) {
		if (wanted.has(key)) continue;
		const [projectId, , kind] = key.split(":");
		const slash = kind!.lastIndexOf("/");
		registry.unregister(kind!.slice(0, slash), kind!.slice(slash + 1), projectId);
		loaded.delete(key);
		logger.info(`plugin integration ${kind}@${version} left ${projectId}`, "WORKER.plugins");
	}
	const failures: string[] = [];
	await Promise.all(
		[...wanted].map(async ([key, ref]) => {
			const current = loaded.get(key);
			if (current === ref.version) return;
			if (current) {
				failures.push(`${label(ref)}: version ${current} is loaded here`);
				return;
			}
			try {
				registry.register(await importIntegration(ref), ref.projectId);
				loaded.set(key, ref.version);
			} catch (error) {
				failures.push((error as Error).message);
			}
		}),
	);
	// one bad plugin must not keep the others out: each failure is reported, the rest load
	for (const message of failures) logger.error(message, "WORKER.plugins");
	return failures;
}

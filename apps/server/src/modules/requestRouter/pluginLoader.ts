import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type BlockMeta, registerModuleBlock, unregisterById } from "@fluxify/blocks";
import type { PluginPermissions } from "../../db/schema";
import type { PluginArtifact } from "../compiler/artifacts";
import { provideHostPackages } from "./hostPackages";
import { NO_PERMISSIONS, withGrantedContext } from "./pluginPermissions";

/**
 * Where one programmable block's code is on this node. Plain data: the
 * supervisor hands these to the execution process, which imports nothing until
 * an artifact calls the block.
 */
export type PluginBlockRef = {
	projectId: string;
	/** the block type a canvas names, e.g. "acme/slack/messages/post" */
	type: string;
	/** e.g. "acme/slack" */
	plugin: string;
	/** part of `entry`'s path, so an upgrade imports fresh code */
	version: string;
	/** hash of the plugin source archive, for version-mismatch checks */
	integrity?: string;
	/** absolute path to the block's built module under `pluginDir(...)` */
	entry: string;
	meta: BlockMeta;
	/** what the plugin's approval granted (#857); none when absent */
	permissions?: PluginPermissions;
};

/**
 * The refs of a published plugin (#857) once it is installed under `root`
 * (`pluginDir(projectId, name, version)`): what the supervisor hands over.
 */
export const pluginBlockRefs = (artifact: PluginArtifact, root: string): PluginBlockRef[] =>
	Object.entries(artifact.blocks).map(([type, block]) => ({
		projectId: artifact.projectId,
		type,
		plugin: artifact.name,
		version: artifact.version,
		integrity: artifact.integrity,
		entry: join(root, block.entry),
		meta: block.meta,
		permissions: artifact.permissions,
	}));

const blockKey = (projectId: string, type: string) => `${projectId}:${type}`;

/** what each `projectId:type` resolves to, as the supervisor last said */
const refs = new Map<string, PluginBlockRef>();
/** imported and in the block library */
const loaded = new Map<string, { version: string; id: string }>();
/** imports under way, so artifacts loading together import a module once */
const loading = new Map<string, Promise<void>>();
/** artifact key -> the blocks it calls; the last user leaving unregisters a block */
const users = new Map<string, Set<string>>();

export function setPluginRefs(list: PluginBlockRef[] = []) {
	refs.clear();
	for (const ref of list) refs.set(blockKey(ref.projectId, ref.type), ref);
}

const label = (ref: PluginBlockRef) => `plugin ${ref.plugin}@${ref.version} block ${ref.type}`;

async function importBlock(key: string, ref: PluginBlockRef) {
	provideHostPackages();
	try {
		const run = (await import(pathToFileURL(ref.entry).href))?.default?.run;
		if (typeof run !== "function") throw new Error("its default export has no run function");
		// ids are unique across projects and blocks, or registering one drops another
		const id = `${ref.plugin}@${ref.version}:${key}`;
		// validates `meta.handles`, so a bad manifest fails here and not on first route
		const granted = withGrantedContext(run, ref.permissions ?? NO_PERMISSIONS, label(ref));
		registerModuleBlock(ref.projectId, ref.type, granted, ref.meta, id);
		loaded.set(key, { version: ref.version, id });
	} catch (error) {
		throw new Error(`${label(ref)} failed to load from ${ref.entry}: ${(error as Error).message}`);
	}
}

function loadBlock(projectId: string, type: string): Promise<void> | undefined {
	const key = blockKey(projectId, type);
	const ref = refs.get(key);
	if (!ref) return Promise.reject(new Error(`no plugin installed provides block ${type}`));
	const current = loaded.get(key);
	if (current?.version === ref.version) return;
	// ESM cannot be unloaded: the supervisor replaces this process on an upgrade
	// and never sends it the new version, so this means refs and loads diverged
	if (current)
		return Promise.reject(new Error(`${label(ref)}: version ${current.version} is loaded here`));
	let pending = loading.get(key);
	if (!pending) {
		pending = importBlock(key, ref).finally(() => loading.delete(key));
		loading.set(key, pending);
	}
	return pending;
}

/**
 * Imports the plugin blocks an artifact calls. Undefined when every one is
 * already loaded, so the common case stays synchronous; otherwise a promise
 * that rejects naming the first plugin, version and type that failed.
 */
export function loadPluginBlocks(projectId: string, types: string[]) {
	const pending = types.map((type) => loadBlock(projectId, type)).filter(Boolean);
	return pending.length ? Promise.all(pending).then(() => {}) : undefined;
}

/**
 * Records which blocks an applied artifact calls (none once it is removed).
 * A block nothing calls any more leaves the library; its module stays in
 * memory until the next process replace.
 */
export function usePluginBlocks(artifactKey: string, projectId?: string, types: string[] = []) {
	const previous = users.get(artifactKey);
	const next = new Set(types.map((type) => blockKey(projectId!, type)));
	if (next.size) users.set(artifactKey, next);
	else users.delete(artifactKey);
	for (const key of previous ?? []) {
		// ponytail: scans every artifact on release; index by block if a worker holds thousands
		if (next.has(key) || [...users.values()].some((used) => used.has(key))) continue;
		const entry = loaded.get(key);
		if (entry) unregisterById(entry.id);
		loaded.delete(key);
	}
}

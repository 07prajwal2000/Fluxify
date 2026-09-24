import { join } from "node:path";

/**
 * Where a node keeps projects' installed npm packages (#477):
 *
 *   <root>/<projectId>/v<N>/     one install per deps version
 *   <root>/<projectId>/current   symlink to the version compiled imports load
 *
 * The compiler emits the same `FLUXIFY_DEPS_DIR ?? "/deps"` lookup, so a
 * change to the default has to be made in `packages/blocks/compiler.ts` too.
 */
export function depsRoot(env: NodeJS.ProcessEnv = process.env) {
	return env.FLUXIFY_DEPS_DIR ?? "/deps";
}

export const projectDepsDir = (projectId: string, root = depsRoot()) => join(root, projectId);

export const versionDir = (projectId: string, version: number, root = depsRoot()) =>
	join(root, projectId, `v${version}`);

export const currentLink = (projectId: string, root = depsRoot()) =>
	join(root, projectId, "current");

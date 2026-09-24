import { isBuiltin } from "node:module";
import { packageName } from "./imports";

/**
 * How a compiled graph loads a project's npm packages (#477). Server-side only:
 * the portal imports `./imports`, never this.
 */

export type ProjectDependencies = { projectId: string; packages: string[] };

/** the npm package a specifier needs, or null for builtins and paths */
export function npmPackage(spec: string) {
	const pkg = packageName(spec);
	return pkg && !isBuiltin(pkg) && pkg !== "bun" ? pkg : null;
}

export function assertInstalled(spec: string, dependencies?: ProjectDependencies) {
	const pkg = npmPackage(spec);
	if (pkg && dependencies && !dependencies.packages.includes(pkg)) {
		throw new Error(
			`Package "${pkg}" is not installed in this project; add it under Project settings → npm packages`,
		);
	}
}

/**
 * The argument to `import(...)` for a hoisted specifier. A project package
 * resolves from the project's installed deps, not from next to the worker
 * bundle, which has no node_modules. `current` is a symlink the supervisor
 * repoints on install; the directory comes from the environment so the path is
 * not baked into an artifact that outlives it. `Bun` is a global, so this needs
 * nothing new from `lib` either.
 */
export function importTarget(spec: string, dependencies?: ProjectDependencies) {
	const literal = JSON.stringify(spec);
	if (!dependencies || !npmPackage(spec)) return literal;
	const dir = JSON.stringify(`/${dependencies.projectId}/current/`);
	return `Bun.resolveSync(${literal}, (process.env.FLUXIFY_DEPS_DIR ?? "/deps") + ${dir})`;
}

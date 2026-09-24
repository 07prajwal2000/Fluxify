import { depsRoot } from "../packages/depsDir";

/**
 * Builds the environment exposed to compiled route code.
 *
 * The execution process must not inherit control-plane credentials. Bun's
 * Windows networking support does, however, need SystemRoot to locate system
 * TLS and networking components. The deps directory (#477) is a path, not a
 * secret: compiled imports resolve a project's npm packages from it.
 */
export function executionRuntimeEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
	platform = process.platform,
): NodeJS.ProcessEnv {
	const deps: NodeJS.ProcessEnv = { FLUXIFY_DEPS_DIR: depsRoot(environment) };
	if (platform !== "win32") return deps;

	const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
	return systemRoot ? { ...deps, SystemRoot: systemRoot } : deps;
}

/**
 * Builds the environment exposed to compiled route code.
 *
 * The execution process must not inherit control-plane credentials. Bun's
 * Windows networking support does, however, need SystemRoot to locate system
 * TLS and networking components.
 */
export function executionRuntimeEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
	platform = process.platform,
): NodeJS.ProcessEnv {
	if (platform !== "win32") return {};

	const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
	return systemRoot ? { SystemRoot: systemRoot } : {};
}

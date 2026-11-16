/** What a build without a release tag reports. */
export const UNKNOWN_VERSION = "unknown-version";

/**
 * The release this process runs, e.g. `v2026.11.0` or `nightly-20261113`. The
 * image sets `FLUXIFY_VERSION` from its build arg; a source checkout has none.
 * The only place that reads the variable: read it at call time, never at
 * import, so a bundle does not freeze the build host's value.
 */
export function releaseVersion(env: Record<string, string | undefined> = process.env): string {
	const version = env.FLUXIFY_VERSION?.trim();
	return !version || version === "dev" ? UNKNOWN_VERSION : version;
}

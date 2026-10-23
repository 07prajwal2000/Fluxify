import sdkPackage from "../../package.json";

/**
 * The packages a worker provides to every plugin: one runtime contract, one
 * zod instance and one AI SDK (a plugin's model objects and the host's `ai` agree). A plugin lists them in `peerDependencies`, never `dependencies`,
 * and never installs its own copy. The CLI and the registry check the same
 * rules here, so an upload never passes what `blocks build` refuses.
 */
export const HOST_PACKAGES = ["@fluxify/sdk", "zod", "ai", "@ai-sdk/provider"] as const;
const hosted = new Set<string>(HOST_PACKAGES);

/** the SDK this build ships, checked against a plugin's `sdk` range */
export const SDK_VERSION: string = sdkPackage.version;

type PluginPackage = { dependencies?: Record<string, string> };

/**
 * What is wrong with a plugin's runtime dependencies and its `bun.lock` text
 * (undefined when there is none). A plugin with no runtime dependencies needs
 * no lockfile; one with any needs a lockfile that parses and pins each.
 */
export function dependencyProblems(pkg: PluginPackage, lockfile: string | undefined): string[] {
	const deps = Object.keys(pkg.dependencies ?? {});
	const problems = deps
		.filter((name) => hosted.has(name))
		.map(
			(name) =>
				`${name} is in "dependencies": move it to "peerDependencies" (and "devDependencies"), the worker provides it`,
		);
	const runtime = deps.filter((name) => !hosted.has(name));
	if (!runtime.length) return problems;
	if (!lockfile?.trim())
		return [...problems, "bun.lock is missing or empty: run `bun install` and commit it"];
	let lock: { lockfileVersion?: unknown; packages?: Record<string, unknown> };
	try {
		lock = Bun.JSONC.parse(lockfile) as typeof lock;
	} catch {
		return [...problems, "bun.lock does not parse: run `bun install` again and commit it"];
	}
	if (typeof lock?.lockfileVersion !== "number")
		return [...problems, "bun.lock has no lockfileVersion: run `bun install` again and commit it"];
	const missing = runtime.filter((name) => !lock.packages?.[name]);
	if (missing.length)
		problems.push(`bun.lock does not pin ${missing.join(", ")}: run \`bun install\` and commit it`);
	return problems;
}

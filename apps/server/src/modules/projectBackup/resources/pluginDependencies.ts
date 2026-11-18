import type { PluginDependency } from "@fluxify/sdk/blocks";

/**
 * The plugins a backup restores whose dependency the backup does not hold, or
 * holds at a version out of range (#899), one message each. Nothing stops the
 * restore: the plugin is written like any other and the project's load gate
 * keeps it blocked, naming the dependency, until one in range is installed.
 */
export function missingDependencyWarnings(
	plugins: { name: string; version: string; manifest: { dependencies?: PluginDependency[] } }[],
) {
	const held = new Map(plugins.map((p) => [p.name, p.version]));
	return plugins.flatMap((p) =>
		(p.manifest.dependencies ?? []).flatMap((dep) => {
			const version = held.get(dep.plugin);
			const needs = `Plugin "${p.name}" needs plugin ${dep.plugin} ${dep.range}`;
			const outcome =
				"It restores, but stays blocked until one in range is installed in the project, unless the project has it already.";
			if (version === undefined) return [`${needs}, which this backup does not hold. ${outcome}`];
			if (!Bun.semver.satisfies(version, dep.range))
				return [`${needs}, but this backup holds version ${version}. ${outcome}`];
			return [];
		}),
	);
}

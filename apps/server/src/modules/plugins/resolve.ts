import type { PluginDependency } from "@fluxify/sdk/blocks";

/**
 * Plugin dependency resolution (#899), a pure function of what is installed
 * and what the registry offers: the dependencies to install or upgrade, in the
 * order to install them (a dependency before what needs it), or a
 * `DependencyError` naming why not. Nothing is fetched but through `registry`.
 *
 * A project holds one version of each plugin. A dependency already installed
 * in range is kept; one out of range is upgraded to the newest version in
 * range, unless another installed plugin's range refuses that version.
 */

/** an installed plugin: the version the project holds and what that version depends on */
export type Installed = { plugin: string; version: string; dependencies: PluginDependency[] };

export type Registry = {
	/** the versions of npm package `name` that may be installed, in any order */
	versions(name: string): Promise<string[]>;
	/** the manifest of `name@version`: its plugin name and what it depends on */
	manifest(
		name: string,
		version: string,
	): Promise<{ name: string; dependencies?: PluginDependency[] }>;
};

/** one dependency to install: npm `name@version`; `from` is the version it upgrades */
export type InstallStep = { name: string; plugin: string; version: string; from?: string };

export class DependencyError extends Error {
	constructor(
		readonly kind: "cycle" | "conflict" | "missing",
		message: string,
	) {
		super(message);
	}
}

const satisfies = (version: string, range: string) => Bun.semver.satisfies(version, range);

export async function resolveDependencies(
	root: { plugin: string; dependencies: readonly PluginDependency[] },
	installed: readonly Installed[],
	registry: Registry,
): Promise<InstallStep[]> {
	const have = new Map(installed.map((i) => [i.plugin, i]));
	/** each plugin settled so far: its version, and who asked for it with which range */
	const chosen = new Map<string, { version: string; by: string; range: string }>();
	const steps: InstallStep[] = [];

	/** the newest version in range */
	async function pick(owner: string, dep: PluginDependency) {
		const version = (await registry.versions(dep.name))
			.filter((v) => satisfies(v, dep.range))
			.sort(Bun.semver.order)
			.at(-1);
		if (!version)
			throw new DependencyError(
				"missing",
				`${owner} needs ${dep.name} ${dep.range}, and no version of it on the registry matches`,
			);
		const manifest = await registry.manifest(dep.name, version);
		if (manifest.name !== dep.plugin)
			throw new DependencyError(
				"missing",
				`${dep.name}@${version} is plugin ${manifest.name}, but ${owner} expects ${dep.plugin}`,
			);
		return { version, dependencies: manifest.dependencies ?? [] };
	}

	/**
	 * An upgrade is refused when an installed plugin keeps a range it does not
	 * accept. A plugin the plan settles itself (kept or upgraded) is not asked:
	 * `visit` holds it to the range of the version the plan leaves, so a plan that
	 * upgrades a plugin and what depends on it together is judged on the upgraded
	 * ranges, never the installed ones. The plugin being installed counts the same.
	 */
	function refuseUpgradesOfUsed() {
		for (const step of steps) {
			if (!step.from) continue;
			const refusing = installed.filter(
				(i) =>
					i.plugin !== root.plugin &&
					!chosen.has(i.plugin) &&
					i.dependencies.some((d) => d.plugin === step.plugin && !satisfies(step.version, d.range)),
			);
			if (refusing.length)
				throw new DependencyError(
					"conflict",
					`${chosen.get(step.plugin)!.by} needs ${step.plugin} ${chosen.get(step.plugin)!.range}, so it would be upgraded from ${step.from} to ${step.version}, but ${refusing
						.map(
							(i) =>
								`${i.plugin} needs ${i.dependencies.find((d) => d.plugin === step.plugin)!.range}`,
						)
						.join(", ")}`,
				);
		}
	}

	async function visit(owner: string, dep: PluginDependency, path: string[]) {
		if (path.includes(dep.plugin))
			throw new DependencyError(
				"cycle",
				`Plugin dependencies form a cycle: ${[...path.slice(path.indexOf(dep.plugin)), dep.plugin].join(" -> ")}`,
			);
		const settled = chosen.get(dep.plugin);
		if (settled) {
			if (satisfies(settled.version, dep.range)) return;
			throw new DependencyError(
				"conflict",
				`${owner} needs ${dep.plugin} ${dep.range}, but ${settled.by} needs ${dep.plugin} ${settled.range} (version ${settled.version})`,
			);
		}
		const current = have.get(dep.plugin);
		const kept = current && satisfies(current.version, dep.range);
		const next = kept ? current : await pick(owner, dep);
		chosen.set(dep.plugin, { version: next.version, by: owner, range: dep.range });
		for (const d of next.dependencies) await visit(dep.plugin, d, [...path, dep.plugin]);
		if (!kept)
			steps.push({
				name: dep.name,
				plugin: dep.plugin,
				version: next.version,
				...(current && { from: current.version }),
			});
	}

	for (const dep of root.dependencies) await visit(root.plugin, dep, [root.plugin]);
	refuseUpgradesOfUsed();
	return steps;
}

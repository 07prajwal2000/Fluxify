import type { BackupModule } from "./types";

/**
 * Checks a set of modules and puts each after the ones it `dependsOn`. Every
 * failure is a programming error, so it throws a plain Error at startup
 * (`BACKUP_MODULES` is built with this) rather than at a user's restore.
 */
export function orderModules(modules: BackupModule[]): BackupModule[] {
	const byName = new Map<string, BackupModule>();
	for (const module of modules) {
		if (byName.has(module.name))
			throw new Error(`Backup module "${module.name}" is registered twice`);
		checkVersions(module);
		byName.set(module.name, module);
	}

	const ordered: BackupModule[] = [];
	const state = new Map<string, "visiting" | "done">();
	const visit = (module: BackupModule, path: string[]) => {
		if (state.get(module.name) === "done") return;
		if (state.get(module.name) === "visiting")
			throw new Error(
				`Backup modules depend on each other in a cycle: ${[...path, module.name].join(" → ")}`,
			);
		state.set(module.name, "visiting");
		for (const name of module.dependsOn) {
			const dependency = byName.get(name);
			if (!dependency)
				throw new Error(
					`Backup module "${module.name}" depends on "${name}", which is not registered`,
				);
			visit(dependency, [...path, module.name]);
		}
		state.set(module.name, "done");
		ordered.push(module);
	};
	for (const module of modules) visit(module, []);
	return ordered;
}

/** every version from `minSupported` up must have its step, or an old backup would stall halfway */
function checkVersions({ name, version, minSupported, upgrades }: BackupModule) {
	const whole = (n: number) => Number.isInteger(n) && n >= 1;
	if (!whole(version) || !whole(minSupported) || minSupported > version)
		throw new Error(`Backup module "${name}" needs 1 ≤ minSupported ≤ version`);
	for (let from = minSupported; from < version; from++)
		if (!upgrades[from])
			throw new Error(
				`Backup module "${name}" has no upgrade from v${from}; add upgrades[${from}] or raise minSupported`,
			);
}

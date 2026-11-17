import type { FluxifyManifest, PluginDependency } from "@fluxify/sdk/blocks";
import type { FluxifyEnv } from "../../lib/env";
import { ENVIRONMENTS } from "../../lib/envValues";
import { isUsableIn, liveOf, type PluginRow, unusableReason } from "./meta";

/**
 * Dependencies between a project's plugins (#899), as plain functions of its
 * rows: which plugin needs which, what is missing, and which plugins cannot
 * load because of a dependency. A project holds one version of each plugin, so
 * a dependency is met by the row of its name, when its version is in range.
 * Install, approval and loading read these; the removal and upgrade gates are in `dependencyGates.ts`.
 */

export const dependenciesOf = (row: { manifest: FluxifyManifest }): PluginDependency[] =>
	row.manifest.dependencies ?? [];

const satisfies = (version: string, range: string) => Bun.semver.satisfies(version, range);

/** the rows that declare `plugin` as a dependency, each with the range it asks for */
export const dependentsOf = <R extends PluginRow>(rows: readonly R[], plugin: string) =>
	rows.flatMap((row) => {
		const dep = dependenciesOf(row).find((d) => d.plugin === plugin);
		return dep ? [{ row, range: dep.range }] : [];
	});

/** every plugin that depends on `plugin`, directly or through another, nearest first */
export function allDependentsOf(rows: readonly PluginRow[], plugin: string) {
	const queue = [plugin];
	for (const at of queue)
		for (const { row } of dependentsOf(rows, at))
			if (!queue.includes(row.name)) queue.push(row.name);
	return queue.slice(1);
}

/**
 * `items` with each plugin after the plugins it depends on, the rest in the
 * order given: how a backup writes and restores them. A cycle (refused when
 * registering, so only a hand-edited archive holds one) keeps its given order.
 */
export function inDependencyOrder<
	T extends { name: string; manifest: { dependencies?: { plugin: string }[] } },
>(items: readonly T[]): T[] {
	const byName = new Map(items.map((i) => [i.name, i]));
	const ordered = new Set<T>();
	const seen = new Set<string>();
	const visit = (item: T) => {
		if (seen.has(item.name)) return;
		seen.add(item.name);
		for (const dep of item.manifest.dependencies ?? []) {
			const needed = byName.get(dep.plugin);
			if (needed) visit(needed);
		}
		ordered.add(item);
	};
	for (const item of items) visit(item);
	return [...ordered];
}

/**
 * The first cycle through `start` among `manifests` (by plugin name), as the
 * path `a -> b -> a`; undefined when there is none.
 */
export function cycleThrough(manifests: ReadonlyMap<string, FluxifyManifest>, start: string) {
	const walk = (name: string, path: string[]): string[] | undefined => {
		for (const dep of manifests.get(name)?.dependencies ?? []) {
			if (dep.plugin === start) return [...path, start];
			if (path.includes(dep.plugin)) continue;
			const found = walk(dep.plugin, [...path, dep.plugin]);
			if (found) return found;
		}
		return undefined;
	};
	return walk(start, [start])?.join(" -> ");
}

/** the rows' manifests, `manifest` standing in for the row of its name: what registering it would make */
export function cycleWith(rows: readonly PluginRow[], manifest: FluxifyManifest) {
	const manifests = new Map(rows.map((r) => [r.name, r.manifest]));
	manifests.set(manifest.name, manifest);
	return cycleThrough(manifests, manifest.name);
}

/**
 * Why `row` cannot be approved yet: each dependency that is not installed,
 * out of range, waiting for approval or rejected.
 */
export function approvalBlockers(row: PluginRow, rows: readonly PluginRow[]) {
	const byName = new Map(rows.map((r) => [r.name, r]));
	return dependenciesOf(row).flatMap((dep) => {
		const have = byName.get(dep.plugin);
		const needs = `it needs plugin ${dep.plugin} ${dep.range}`;
		if (!have) return [`${needs}, which is not installed`];
		if (!satisfies(have.version, dep.range))
			return [`${needs}, but version ${have.version} is installed`];
		if (have.approval === "pending") return [`${needs}, which is waiting for approval`];
		if (have.approval === "rejected") return [`${needs}, which was rejected`];
		return [];
	});
}

type Gated<R> = R & Pick<PluginRow, "blocked">;

/**
 * The project's plugins as they load (`liveOf`), each marked `blocked` in the
 * environments a dependency stops it in: missing, out of range, or not loading
 * there itself (pending, rejected, switched off, or blocked in turn). A blocked
 * plugin is unusable like a switched-off one, so its blocks fail to compile
 * naming why, its artifact is withdrawn and its triggers stop.
 */
export function withDependencyGate<R extends PluginRow>(rows: readonly R[]): Gated<R>[] {
	const live = new Map<string, Gated<R>>(rows.map((r) => [r.name, liveOf(r)]));
	const done = new Map<string, Gated<R>>();
	const gate = (name: string, seen: string[]): Gated<R> | undefined => {
		const row = live.get(name);
		if (!row || done.has(name)) return done.get(name) ?? row;
		const blocked: NonNullable<PluginRow["blocked"]> = {};
		for (const dep of dependenciesOf(row)) {
			const have = seen.includes(dep.plugin) ? undefined : gate(dep.plugin, [...seen, dep.plugin]);
			for (const env of ENVIRONMENTS) {
				const why = unmet(dep, have, env, seen.includes(dep.plugin));
				if (why) blocked[env] ??= `it needs plugin ${dep.plugin} ${dep.range}: ${why}`;
			}
		}
		const gated = Object.keys(blocked).length ? { ...row, blocked } : row;
		done.set(name, gated);
		return gated;
	};
	return rows.map((r) => gate(r.name, [r.name])!);
}

function unmet(
	dep: PluginDependency,
	have: PluginRow | undefined,
	env: FluxifyEnv,
	cycle: boolean,
) {
	if (cycle) return "the dependencies form a cycle";
	if (!have) return "it is not installed";
	if (!satisfies(have.version, dep.range)) return `version ${have.version} is installed`;
	return isUsableIn(have, env) ? undefined : unusableReason(have, env);
}

/** what the plugin page lists: what it depends on, in what state, and what depends on it */
export function dependencyView(row: PluginRow, rows: readonly PluginRow[]) {
	const byName = new Map(rows.map((r) => [r.name, r]));
	return {
		dependsOn: dependenciesOf(row).map((dep) => {
			const have = byName.get(dep.plugin);
			return {
				plugin: dep.plugin,
				package: dep.name,
				range: dep.range,
				installed: have ? { version: have.version, approval: have.approval } : null,
				satisfied: !!have && satisfies(have.version, dep.range),
			};
		}),
		usedBy: dependentsOf(rows, row.name).map(({ row: r, range }) => ({
			plugin: r.name,
			version: r.version,
			range,
			approval: r.approval,
		})),
	};
}

/**
 * Two plugins of one project cannot provide the same integration kind: a row
 * names its kind, not its plugin, so it could not say which it means. That
 * holds in a dependency's group too: a variant added to it cannot take a name
 * the dependency or another dependent has. Against every approved plugin,
 * running or not, so no variant is ever skipped when it loads.
 */
export function variantClashes(row: PluginRow, rows: readonly PluginRow[]) {
	const others = rows.map(liveOf).filter((r) => r.name !== row.name && r.approval === "approved");
	return (row.manifest.integrations ?? []).flatMap((e) => {
		const owner = others.find((o) =>
			o.manifest.integrations?.some((x) => x.group === e.group && x.variant === e.variant),
		);
		return owner
			? [
					`Plugin ${row.name} provides integration variant ${e.group}/${e.variant}, which plugin ${owner.name} already provides in this project`,
				]
			: [];
	});
}

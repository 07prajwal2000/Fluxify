import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { parseIntegrationKind } from "@fluxify/sdk/integrations";
import { ConflictError } from "../../errors/conflictError";
import { dependenciesOf, dependentsOf, variantClashes } from "./dependencies";
import type { IntegrationUser } from "./integrationUsage";
import { liveOf, type PluginRow } from "./meta";

/**
 * What stops a plugin that others depend on from being removed or upgraded
 * (#899): pure functions of the project's rows, so the gates read the same in
 * the 409, the upgrade dialog and the tests.
 */

export type Dependent = { plugin: string; version: string; range: string };

/** the approved plugins, as they load, that depend on `name` */
export const removalDependents = (rows: readonly PluginRow[], name: string): Dependent[] =>
	dependentsOf(rows.map(liveOf), name)
		.filter(({ row }) => row.approval === "approved")
		.map(({ row, range }) => ({ plugin: row.name, version: row.version, range }));

/**
 * The variants the plugins depending on `row` add to its groups, as manifests
 * for `pluginIntegrationUsers`. An integration of one is of the plugin's group
 * but belongs to the dependent: `pluginVariantState` names the dependent.
 */
export function variantsAddedTo(rows: readonly PluginRow[], row: PluginRow) {
	const groups = new Set(
		[row.manifest, row.live?.manifest].flatMap((m) => m?.integrations ?? []).map((e) => e.group),
	);
	return dependentsOf(rows, row.name)
		.flatMap(({ row: d }) => [d.manifest, d.live?.manifest])
		.map((m) => ({ integrations: (m?.integrations ?? []).filter((e) => groups.has(e.group)) }));
}

/** The 409 of a remove refused while approved plugins depend on the plugin. */
export class DependentsError extends ConflictError {
	constructor(plugin: string, dependents: Dependent[], integrations: IntegrationUser[]) {
		super(
			`Plugin ${plugin} cannot be removed: ${dependents.map((d) => `${d.plugin}@${d.version} (needs ${d.range})`).join(", ")} depend${dependents.length > 1 ? "" : "s"} on it. Remove ${dependents.length > 1 ? "those" : "that"} plugin${dependents.length > 1 ? "s" : ""} first.`,
		);
		this.details = { dependents, integrations };
	}
}

const kindKey = (e: { group: string; variant: string }) => `${e.group}/${e.variant}`;

/** every integration kind a manifest's blocks and triggers name: permissions, an integration param's kind, and each variant it lists */
function usedKinds(m: FluxifyManifest) {
	return [...Object.values(m.blocks), ...(m.triggers ?? [])].flatMap((e) => [
		...(e.permissions.integrations ?? []),
		...Object.values(e.params).flatMap((p) =>
			p.type === "integration" ? [p.kind, ...(p.variants ?? []).map((v) => `${p.kind}/${v}`)] : [],
		),
	]);
}

/**
 * What a dependent `d` takes from the group or variant `was` provided and
 * `next` no longer does: a kind it uses, or a group it adds a variant to.
 * `rest` are its other dependencies; a variant `d` provides itself still stands.
 */
function dropped(
	d: FluxifyManifest,
	was: FluxifyManifest,
	next: FluxifyManifest,
	rest: FluxifyManifest[],
) {
	const owned = new Set((was.integrations ?? []).map((e) => e.group));
	const others = [next, ...rest].flatMap((m) => m.integrations ?? []);
	const groups = new Set(others.map((e) => e.group));
	const variants = new Set([...others, ...(d.integrations ?? [])].map(kindKey));
	const lines = new Set<string>();
	for (const kind of usedKinds(d)) {
		const parsed = parseIntegrationKind(kind);
		if (!parsed || !owned.has(parsed.group)) continue;
		if (!groups.has(parsed.group)) lines.add(`uses integration group ${parsed.group}`);
		else if (parsed.variant && !variants.has(`${parsed.group}/${parsed.variant}`))
			lines.add(`uses integration variant ${parsed.group}/${parsed.variant}`);
	}
	for (const e of d.integrations ?? [])
		if (owned.has(e.group) && !groups.has(e.group))
			lines.add(`adds its variant ${e.variant} to integration group ${e.group}`);
	return [...lines];
}

/**
 * Why the upgrade of `next` (its pending version, `was` the one it replaces)
 * would break a plugin that depends on it: the new version is outside a
 * dependent's range, it drops a group or variant the dependent uses or adds a
 * variant to, or it adds a variant a dependent already provides. A dependent
 * whose own upgrade waits counts as that upgrade: it is the version the creator
 * is moving it to, and two upgrades that need each other could never be
 * approved otherwise; its old version stays blocked, with the reason shown,
 * until it is approved.
 */
export function upgradeBlockers(
	next: PluginRow,
	was: FluxifyManifest,
	rows: readonly PluginRow[],
): string[] {
	const others = rows.filter((r) => r.name !== next.name);
	const affected = others.filter(
		(r) => r.approval === "approved" || (r.approval === "pending" && r.live),
	);
	const lines = dependentsOf(affected, next.name).flatMap(({ row: d, range }) => {
		const who = `plugin ${d.name}@${d.version}`;
		const rest = dependenciesOf(d).flatMap((dep) => {
			const found = others.find((o) => o.name === dep.plugin);
			return found && dep.plugin !== next.name ? [liveOf(found).manifest] : [];
		});
		return [
			...(Bun.semver.satisfies(next.version, range)
				? []
				: [`${who} needs ${next.name} ${range}, and version ${next.version} is outside it`]),
			...dropped(d.manifest, was, next.manifest, rest).map(
				(what) => `${who} ${what}, which ${next.name}@${next.version} drops`,
			),
		];
	});
	return [...lines, ...variantClashes(next, rows)];
}

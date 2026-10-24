import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { paramChange } from "./integrationDiff";
import type { TriggerUser } from "./triggerUsage";
import { type IntegrationKinds, variantsChange } from "./variantDiff";

/** who a changed trigger kind affects: the project's triggers of it */
export type TriggerUsedBy = { id: string; name: string }[];

/** One change to a trigger kind an upgrade makes (T2); `breaking` blocks only while `usedBy` has rows. */
export type TriggerChange = {
	kind: string;
	change: string;
	breaking: boolean;
	usedBy: TriggerUsedBy;
};

export type TriggerDiff = {
	/** kinds the new version adds */
	addedTriggers: string[];
	/** kinds it drops */
	removedTriggers: { kind: string; usedBy: TriggerUsedBy }[];
	changedTriggers: TriggerChange[];
};

type Entry = NonNullable<FluxifyManifest["triggers"]>[number];

/**
 * The triggers half of `diffManifests`. Kinds are matched by name. A param
 * removed or retyped affects the rows that set it; one newly required affects
 * the rows that do not; a narrowed grant affects every row of the kind, since
 * its integration params may point at a kind no longer granted; narrowed
 * `variants` affect the rows whose integration (by `kinds`) it drops. Label, icon and
 * description changes are not listed; a `retry` change is, and breaks nothing.
 */
export function diffTriggers(
	old: FluxifyManifest,
	next: FluxifyManifest,
	users: TriggerUser[],
	kinds: IntegrationKinds = new Map(),
): TriggerDiff {
	const before = new Map<string, Entry>((old.triggers ?? []).map((e) => [e.name, e]));
	const after = new Map<string, Entry>((next.triggers ?? []).map((e) => [e.name, e]));
	const rows = (kind: string, keep: (u: TriggerUser) => boolean = () => true) =>
		users.filter((u) => u.kind === kind && keep(u)).map(({ id, name }) => ({ id, name }));
	const diff: TriggerDiff = {
		addedTriggers: [...after.keys()].filter((k) => !before.has(k)),
		removedTriggers: [],
		changedTriggers: [],
	};
	for (const [kind, was] of before) {
		const now = after.get(kind);
		if (!now) {
			diff.removedTriggers.push({ kind, usedBy: rows(kind) });
			continue;
		}
		const change = (change: string, breaking: boolean, usedBy: TriggerUsedBy) =>
			diff.changedTriggers.push({ kind, change, breaking, usedBy });
		for (const name of new Set([...Object.keys(was.params), ...Object.keys(now.params)])) {
			const [p, q] = [was.params[name], now.params[name]];
			const sets = (u: TriggerUser) => u.params.includes(name);
			const moved = paramChange(name, p, q);
			if (moved) {
				// removed or retyped: the rows holding a value; newly required: the rows without one
				const retyped = !q || (p && p.type !== q.type);
				const usedBy = !moved.breaking ? [] : rows(kind, retyped ? sets : (u) => !sets(u));
				change(moved.change, moved.breaking, usedBy);
			} else if (p?.type === "integration" && q?.type === "integration" && p.kind !== q.kind)
				change(`param ${name} now takes a ${q.kind}, not a ${p.kind}`, true, rows(kind, sets));
			const variants = variantsChange(name, p, q);
			if (variants) {
				const usedBy = rows(kind, (u) => variants.drops(u.values?.[name], kinds));
				change(variants.change, usedBy.length > 0, usedBy);
			}
		}
		const dropped = (was.permissions.integrations ?? []).filter(
			(k) => !(now.permissions.integrations ?? []).includes(k),
		);
		if (dropped.length) change(`no longer granted ${dropped.join(", ")}`, true, rows(kind));
		if (was.retry !== now.retry)
			change(`retry turned ${now.retry ? "on" : "off"}`, false, rows(kind));
	}
	return diff;
}

/** one line per blocking change, for the 409 */
export function triggerBlockers(diff: TriggerDiff) {
	const names = (u: TriggerUsedBy) => u.map((r) => `trigger "${r.name}"`).join(", ");
	return [
		...diff.removedTriggers
			.filter((r) => r.usedBy.length)
			.map((r) => `trigger kind ${r.kind} is removed but used by ${names(r.usedBy)}`),
		...diff.changedTriggers
			.filter((c) => c.breaking && c.usedBy.length)
			.map((c) => `trigger kind ${c.kind}: ${c.change}, but used by ${names(c.usedBy)}`),
	];
}

import type { FluxifyManifest, IntegrationEntry } from "@fluxify/sdk/blocks";
import { type IntegrationUser, kindOf } from "./integrationUsage";

/** who uses a changed kind: the project's integrations of it */
export type IntegrationUsedBy = { id: string; name: string }[];

/**
 * One change to an integration variant an upgrade makes (I6). `breaking` is a
 * change existing rows may not survive; it blocks only while such rows exist.
 */
export type IntegrationChange = {
	/** the kind as it was (`acme/crm/Hub`, `kv/Upstash`) */
	kind: string;
	change: string;
	breaking: boolean;
	usedBy: IntegrationUsedBy;
};

export type IntegrationDiff = {
	/** kinds the new version adds */
	addedIntegrations: string[];
	/** kinds it drops */
	removedIntegrations: { kind: string; usedBy: IntegrationUsedBy }[];
	changedIntegrations: IntegrationChange[];
};

type Entry = IntegrationEntry & { entry?: string };
type Param = Entry["configSchema"][string];

const required = (p: Param) =>
	(p as { required?: boolean }).required === true &&
	(p as { default?: unknown }).default === undefined;

/** how one param moved, or undefined when nothing a stored config depends on did */
export function paramChange(name: string, before: Param | undefined, after: Param | undefined) {
	if (!before && !after) return undefined;
	if (!after)
		return before!.type === "hint"
			? undefined
			: { change: `param ${name} removed`, breaking: true };
	if (!before)
		return required(after)
			? { change: `required param ${name} added`, breaking: true }
			: { change: `optional param ${name} added`, breaking: false };
	if ((before.type === "secret") !== (after.type === "secret"))
		return { change: `param ${name} changed between secret and plain`, breaking: true };
	if (before.type !== after.type)
		return {
			change: `param ${name} changed type from ${before.type} to ${after.type}`,
			breaking: true,
		};
	if (!required(before) && required(after))
		return { change: `param ${name} is now required`, breaking: true };
	return undefined;
}

/**
 * The integrations half of `diffManifests`. Variants are matched by their
 * definition's `name` (its file), so a new group or variant name reads as a
 * changed kind. `users` are the project's integrations of the old version's kinds.
 */
export function diffIntegrations(
	old: FluxifyManifest,
	next: FluxifyManifest,
	users: IntegrationUser[],
): IntegrationDiff {
	const usedBy = (kind: string) =>
		users.filter((u) => kindOf(u) === kind).map(({ id, name }) => ({ id, name }));
	const before = new Map<string, Entry>((old.integrations ?? []).map((e) => [e.name, e]));
	const after = new Map<string, Entry>((next.integrations ?? []).map((e) => [e.name, e]));
	const diff: IntegrationDiff = {
		addedIntegrations: [...after.values()].filter((e) => !before.has(e.name)).map(kindOf),
		removedIntegrations: [],
		changedIntegrations: [],
	};
	for (const [name, was] of before) {
		const kind = kindOf(was);
		const now = after.get(name);
		if (!now) {
			diff.removedIntegrations.push({ kind, usedBy: usedBy(kind) });
			continue;
		}
		const change = (change: string, breaking: boolean) =>
			diff.changedIntegrations.push({ kind, change, breaking, usedBy: usedBy(kind) });
		if (kindOf(now) !== kind) change(`now ${kindOf(now)}`, true);
		const params = new Set([...Object.keys(was.configSchema), ...Object.keys(now.configSchema)]);
		for (const param of params) {
			const moved = paramChange(param, was.configSchema[param], now.configSchema[param]);
			if (moved) change(moved.change, moved.breaking);
		}
	}
	return diff;
}

/** one line per blocking change, for the 409 */
export function integrationBlockers(diff: IntegrationDiff) {
	const names = (u: IntegrationUsedBy) => u.map((r) => `integration "${r.name}"`).join(", ");
	return [
		...diff.removedIntegrations
			.filter((r) => r.usedBy.length)
			.map((r) => `integration variant ${r.kind} is removed but used by ${names(r.usedBy)}`),
		...diff.changedIntegrations
			.filter((c) => c.breaking && c.usedBy.length)
			.map((c) => `integration variant ${c.kind}: ${c.change}, but used by ${names(c.usedBy)}`),
	];
}

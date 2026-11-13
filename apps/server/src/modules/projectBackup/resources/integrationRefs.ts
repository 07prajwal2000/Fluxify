import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbTransactionType } from "../../../db";
import { integrationsEntity } from "../../../db/schema";
import type { IdMap } from "../types";

/**
 * Integration references in a backup (#1100), shared by every section that
 * holds one: canvases (block data, in the working copy and every version), a
 * route's SSE broker, test suite overrides, a trigger's connector and a plugin
 * trigger's params, project settings.
 *
 * An integration id is a uuid no other value holds, so a reference is found by
 * its value, wherever it sits, as `pluginTriggersUsing` finds one: no list of
 * fields to keep up with, and a plugin param of any name is covered. The ids
 * stay in the data as they were; each section carries a table naming them
 * (`integrations`: source id → name), and a restore resolves the name through
 * `ctx.ids.get("integrations", name)`. A name, unlike a uuid, could equal some
 * other string in the data, so it is never written in place.
 *
 * A reference that doesn't resolve (the integrations section was left out, or
 * the integration is not in it) is blanked, never refused; `inspect` says which.
 */

/** source integration id → its name; "" when the name is unknown (a v1 section) */
export const integrationTableSchema = z.record(z.string(), z.string()).default({});
export type IntegrationTable = z.infer<typeof integrationTableSchema>;

/** a string → its replacement, or undefined to keep it */
export type Lookup = (value: string) => string | undefined;

/** `data` with every string `lookup` knows replaced. Pure: `data` is left as it was. */
export function remapIntegrations<T>(data: T, lookup: Lookup): T {
	const walk = (value: unknown): unknown => {
		if (typeof value === "string") return lookup(value) ?? value;
		if (Array.isArray(value)) return value.map(walk);
		if (value && typeof value === "object")
			return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
		return value;
	};
	return walk(data) as T;
}

const visit = (data: unknown, seen: (value: string) => void) =>
	void remapIntegrations(data, (value) => void seen(value));

/** export: the project's integrations, id → name, read in the section's transaction */
export async function integrationNames(projectId: string, tx: DbTransactionType) {
	const rows = await tx
		.select({ id: integrationsEntity.id, name: integrationsEntity.name })
		.from(integrationsEntity)
		.where(eq(integrationsEntity.projectId, projectId));
	return new Map(rows.map((r) => [r.id, r.name ?? ""]));
}

/** export: the table entry of every one of `names` that `data` holds */
export function tableFor(data: unknown, names: Map<string, string>): IntegrationTable {
	const table: IntegrationTable = {};
	visit(data, (value) => {
		const name = names.get(value);
		if (name !== undefined) table[value] = name;
	});
	return table;
}

/** an entry's name, or undefined when there is none to resolve (a v1 id) */
const nameOf = (table: IntegrationTable, value: string) =>
	Object.hasOwn(table, value) ? table[value] : undefined;

/** import: a source id → this project's id, "" when its name doesn't resolve here */
export const localIntegrations =
	(table: IntegrationTable, ids: IdMap): Lookup =>
	(value) => {
		const name = nameOf(table, value);
		if (name === undefined) return undefined;
		// no name never matches, not even an integration that has none
		return (name && ids.get("integrations", name)) || "";
	};

/** inspect: the integration names the archive restores; none when it has no integrations section */
export function restoredNames(read: (section: string) => unknown) {
	const section = read("integrations") as { integrations: { name: string }[] } | undefined;
	return new Set(section?.integrations.map((i) => i.name) ?? []);
}

/** somewhere in a resource that may hold a reference, e.g. `block db_get_1` */
export type Place = { where: string; value: unknown };

const label = (name: string) => (name ? `"${name}"` : "an integration from an older backup");

/**
 * inspect: one warning per resource whose references won't resolve, naming
 * each place and integration, then what the blank does (`consequence`).
 */
export function lostWarnings(
	owner: string,
	places: Place[],
	table: IntegrationTable,
	have: Set<string>,
	consequence: string,
): string[] {
	const parts = places.flatMap(({ where, value }) => {
		const lost = new Set<string>();
		visit(value, (v) => {
			const name = nameOf(table, v);
			if (name !== undefined && !(name && have.has(name))) lost.add(name);
		});
		return lost.size ? [`${where} (${[...lost].map(label).join(", ")})`] : [];
	});
	if (!parts.length) return [];
	return [
		`${owner} uses integrations this backup doesn't restore: ${parts.join("; ")}. ${consequence}`,
	];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the keys a v1 section held an integration id under: block data, SSE broker, suite overrides, trigger */
const V1_KEYS = new Set(["connection", "integrationId", "sseBrokerId", "existing", "replacement"]);

/**
 * The table a v1 (id-based) section never had, for the v1 → v2 upgrade steps:
 * every uuid it held under an integration key, and with `sourceParams` every
 * uuid among a trigger's `source` params, each with no name, so the restore
 * blanks it. A v1 archive predates the integrations section, so nothing could
 * resolve anyway. Pure, and part of released upgrade steps: never change it.
 */
export function v1Table(section: unknown, { sourceParams = false } = {}): IntegrationTable {
	const table: IntegrationTable = {};
	const walk = (value: unknown, parent?: string) => {
		if (!value || typeof value !== "object") return;
		for (const [key, v] of Object.entries(value)) {
			const ref = V1_KEYS.has(key) || (sourceParams && parent === "source");
			if (typeof v === "string" && ref && UUID.test(v)) table[v] = "";
			else walk(v, Array.isArray(value) ? parent : key);
		}
	};
	walk(section);
	return table;
}

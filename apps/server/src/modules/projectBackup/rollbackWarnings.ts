import { integrationKindCovers } from "@fluxify/sdk/integrations";
import { eq } from "drizzle-orm";
import type { DbTransactionType } from "../../db";
import { integrationsEntity, pluginsEntity } from "../../db/schema";
import { SCHEDULE_OFF_WARNING } from "./resources/projectSettings";
import type { RestorePlan } from "./restore";
import type { RollbackConflict } from "./types";

/**
 * A rollback's warnings (#1130 follow-up), each with the choices it applies to,
 * as a conflict has (`activeConflicts` evaluates both): never a refusal.
 *
 * The archive's own `inspect` warnings say what *this backup* lacks; in a
 * rollback the project may still have it. And an exact replica can remove what
 * kept resources still use in ways no reference records: code reading an app
 * config key, a plugin that needs an integration of some kind.
 */
export type RollbackNote = RollbackConflict & {
	section: string;
	/** about what an exact replica removes: shown beside the removal list too */
	removal?: boolean;
};

/** how a section names one of its resources in a sentence */
const NOUNS: Record<string, string> = {
	appConfig: "app config key",
	integrations: "integration",
	plugins: "plugin",
	customBlocks: "custom block",
	middlewares: "middleware",
	workflows: "workflow",
	routes: "route",
	triggers: "trigger",
	knowledgeSources: "knowledge source",
	projectSettings: "project setting",
};
export const noun = (section: string) => NOUNS[section] ?? `${section} resource`;

const dataOf = (plan: RestorePlan, section: string) =>
	plan.sections.find((s) => s.module.name === section)?.data as Record<string, unknown> | undefined;

/**
 * Sections whose "this backup doesn't restore X" warnings the project can make
 * untrue, and the list in the section that names each X. `restoredNames` and
 * `missingPluginWarnings` read exactly these.
 */
const SATISFIABLE: Record<string, string> = { integrations: "integrations", plugins: "plugins" };

/**
 * The archive's warnings, resolved against the project. For each satisfiable
 * section, the modules that read it inspect again as if the project's own
 * resources of it were in the archive. A warning only the archive gives holds
 * when the rollback removes the project's (exact replica, that section chosen);
 * one only the project gives holds when it keeps them. The rest always hold.
 * Each applies only when its own section is restored.
 */
export async function resolvedWarnings(
	plan: RestorePlan,
	projectId: string,
	tx: DbTransactionType,
) {
	const base = plan.warnings.filter((w) => w.message !== SCHEDULE_OFF_WARNING);
	const notes: RollbackNote[] = [];
	const changed = new Set<string>();
	for (const [section, list] of Object.entries(SATISFIABLE)) {
		const module = plan.modules.find((m) => m.name === section);
		const names = module?.existing ? [...(await module.existing(projectId, tx)).keys()] : [];
		if (!names.length) continue;
		const read = (name: string) => {
			const data = dataOf(plan, name);
			if (name !== section) return data;
			const archived = (data?.[list] as unknown[] | undefined) ?? [];
			return { ...data, [list]: [...archived, ...names.map((n) => ({ name: n }))] };
		};
		// a module reads only its dependencies: the others' warnings can't change
		for (const s of plan.sections.filter((p) => p.module.dependsOn.includes(section))) {
			const own = s.module.name;
			const before = base.filter((w) => w.section === own).map((w) => w.message);
			const after =
				(await s.module.inspect?.(s.data, read, { files: s.files, mode: plan.manifest.mode })) ??
				[];
			for (const message of before.filter((m) => !after.includes(m))) {
				changed.add(message);
				notes.push({ section: own, message, mode: "exact", selected: [own, section], kept: [] });
			}
			for (const message of after.filter((m) => !before.includes(m)))
				notes.push(
					{ section: own, message, mode: "keep", selected: [own], kept: [] },
					{ section: own, message, mode: "exact", selected: [own], kept: [section] },
				);
		}
	}
	for (const { section, message } of base.filter((w) => !changed.has(w.message)))
		for (const mode of ["keep", "exact"] as const)
			notes.push({ section, message, mode, selected: [section], kept: [] });
	return notes;
}

/** every resource of an exported section, by the name it goes by */
function entriesOf(data: unknown) {
	const found: { label: string; value: unknown }[] = [];
	for (const list of Object.values((data ?? {}) as Record<string, unknown>)) {
		if (!Array.isArray(list)) continue;
		for (const item of list as Record<string, unknown>[]) {
			const label = item?.name ?? item?.key;
			if (typeof label === "string") found.push({ label, value: item });
		}
	}
	return found;
}

function stringsOf(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") out.push(value);
	else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
	else if (value && typeof value === "object")
		for (const v of Object.values(value)) stringsOf(v, out);
	return out;
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Exact replica: an app config key it removes that a resource it keeps may
 * still read. Found by value, as the integration remapper finds ids: the key
 * as a whole word in any string the resource holds (a JS block's code, a
 * `cfg:KEY`, a suite override, a trigger payload, a header). A mention in a
 * comment counts too; it is only a warning.
 */
export function keyNotes(keys: string[], current: Map<string, unknown>): RollbackNote[] {
	const notes: RollbackNote[] = [];
	for (const key of keys) {
		const word = new RegExp(`(?<![\\w-])${literal(key)}(?![\\w-])`);
		for (const [section, data] of current)
			for (const { label, value } of entriesOf(data))
				if (stringsOf(value).some((s) => word.test(s)))
					notes.push({
						section: "appConfig",
						removal: true,
						message: `App config key "${key}" will be removed, but ${noun(section)} "${label}" may still read it.`,
						mode: "exact",
						selected: ["appConfig"],
						kept: [section],
					});
	}
	return notes;
}

type Permissions = { integrations?: string[] } | null;
type Kinded = { group: string | null; variant: string | null };

/**
 * Exact replica with integrations chosen: a plugin whose permissions name a
 * kind the project has an integration of now, and won't once the rollback
 * removes the ones the backup lacks. The plugin is the project's own when
 * plugins aren't restored, or the backup's when they are.
 */
export async function pluginKindNotes(plan: RestorePlan, projectId: string, tx: DbTransactionType) {
	const archived = dataOf(plan, "integrations")?.integrations as Kinded[] | undefined;
	if (!archived) return [];
	const now = await tx
		.select({ group: integrationsEntity.group, variant: integrationsEntity.variant })
		.from(integrationsEntity)
		.where(eq(integrationsEntity.projectId, projectId));
	const reaches = (kind: string, list: Kinded[]) =>
		list.some((i) => integrationKindCovers(kind, i.group ?? "", i.variant ?? ""));
	const lost = (permissions: Permissions) =>
		(permissions?.integrations ?? []).filter((k) => reaches(k, now) && !reaches(k, archived));

	const own = await tx
		.select({ name: pluginsEntity.name, permissions: pluginsEntity.permissions })
		.from(pluginsEntity)
		.where(eq(pluginsEntity.projectId, projectId));
	const restored =
		(dataOf(plan, "plugins")?.plugins as { name: string; permissions: Permissions }[]) ?? [];
	const notes: RollbackNote[] = [];
	const note = (name: string, kind: string, selected: string[], kept: string[]) =>
		notes.push({
			section: "integrations",
			removal: true,
			message: `Plugin "${name}" uses ${kind} integrations, and none will be left.`,
			mode: "exact",
			selected,
			kept,
		});
	for (const p of own)
		for (const kind of lost(p.permissions)) note(p.name, kind, ["integrations"], ["plugins"]);
	for (const p of restored)
		for (const kind of lost(p.permissions)) note(p.name, kind, ["integrations", "plugins"], []);
	return notes;
}

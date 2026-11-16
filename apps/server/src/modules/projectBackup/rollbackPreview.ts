import { db } from "../../db";
import { SCHEDULE_OFF_WARNING } from "./resources/projectSettings";
import type { RestorePlan } from "./restore";
import type { RollbackConflict } from "./types";

/**
 * What a rollback into a project would do (#1130), with nothing written: per
 * section, which resources it updates, creates and (exact replica) removes,
 * and what would stop it. Both modes and every choice of sections at once, so
 * the dialog can follow the user's choices without asking again.
 */

export type SectionChanges = {
	section: string;
	/** in the project and the backup: updated in place, keeping their ids */
	update: string[];
	/** only in the backup */
	create: string[];
	/** only in the project: kept, or removed by an exact replica */
	extras: string[];
	/** a section with no named resources (the npm packages): restored over what is there */
	replaced: boolean;
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
const noun = (section: string) => NOUNS[section] ?? `${section} resource`;

export async function previewRollback(plan: RestorePlan, projectId: string) {
	return await db.transaction(async (tx) => {
		const sections: SectionChanges[] = [];
		for (const { module, data } of plan.sections) {
			if (!module.existing || !module.names) {
				sections.push({ section: module.name, update: [], create: [], extras: [], replaced: true });
				continue;
			}
			const existing = await module.existing(projectId, tx);
			const names = new Set(module.names(data));
			sections.push({
				section: module.name,
				update: [...names].filter((n) => existing.has(n)),
				create: [...names].filter((n) => !existing.has(n)),
				extras: [...existing.keys()].filter((n) => !names.has(n)),
				replaced: false,
			});
		}

		const conflicts: RollbackConflict[] = [];
		for (const { module, data } of plan.sections)
			conflicts.push(...((await module.conflicts?.(data, projectId, tx)) ?? []));
		conflicts.push(...(await brokenUses(plan, projectId, sections)));
		return {
			sections,
			conflicts: dedupe(conflicts),
			// the rollback leaves the project's own scheduled backups as they are
			warnings: plan.warnings.filter((w) => w.message !== SCHEDULE_OFF_WARNING),
		};
	});
}

/**
 * Exact replica removes a section's extras. One that a resource the rollback
 * keeps still uses (a section left out, or one the archive doesn't hold) would
 * leave that resource broken, so it is refused, naming both. What the project
 * uses now is read through each module's own export.
 */
async function brokenUses(plan: RestorePlan, projectId: string, sections: SectionChanges[]) {
	const extras = new Map(sections.map((s) => [s.section, new Set(s.extras)]));
	if (![...extras.values()].some((names) => names.size)) return [];
	const conflicts: RollbackConflict[] = [];
	for (const module of plan.modules) {
		if (!module.uses) continue;
		const { data } = await module.export({
			projectId,
			mode: "backup",
			options: { includeVersionHistory: false, includeAppConfigValues: false },
		});
		for (const use of module.uses(data)) {
			if (use.section === module.name || !extras.get(use.section)?.has(use.name)) continue;
			conflicts.push({
				message: `${use.owner} uses the ${noun(use.section)} "${use.name}", which an exact replica would remove. Restore the ${noun(module.name)}s too, or keep extras.`,
				mode: "exact",
				selected: [use.section],
				kept: [module.name],
			});
		}
	}
	return conflicts;
}

const dedupe = (conflicts: RollbackConflict[]) => [
	...new Map(conflicts.map((c) => [c.message, c])).values(),
];

/** the conflicts that stop a rollback with these choices; the portal evaluates the same rule */
export const activeConflicts = (
	conflicts: RollbackConflict[],
	prune: boolean,
	sections: string[],
) =>
	conflicts.filter(
		(c) =>
			c.mode === (prune ? "exact" : "keep") &&
			c.selected.every((s) => sections.includes(s)) &&
			c.kept.every((s) => !sections.includes(s)),
	);

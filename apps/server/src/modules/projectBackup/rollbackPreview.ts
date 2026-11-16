import { logger } from "@fluxify/common";
import { db } from "../../db";
import type { RestorePlan } from "./restore";
import {
	keyNotes,
	noun,
	pluginKindNotes,
	type RollbackNote,
	resolvedWarnings,
} from "./rollbackWarnings";
import type { RollbackConflict } from "./types";

/**
 * What a rollback into a project would do (#1130), with nothing written: per
 * section, which resources it updates, creates and (exact replica) removes,
 * what would stop it and what to know. Both modes and every choice of sections
 * at once, so the dialog can follow the user's choices without asking again.
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

		const extras = (section: string) => sections.find((s) => s.section === section)?.extras ?? [];
		const current = sections.some((s) => s.extras.length)
			? await currentData(plan, projectId)
			: new Map<string, unknown>();
		const conflicts: RollbackConflict[] = [];
		for (const { module, data } of plan.sections)
			conflicts.push(...((await module.conflicts?.(data, projectId, tx)) ?? []));
		conflicts.push(...brokenUses(plan, current, sections));
		const notes: RollbackNote[] = [
			...(await resolvedWarnings(plan, projectId, tx)),
			...keyNotes(extras("appConfig"), current),
			...(extras("integrations").length ? await pluginKindNotes(plan, projectId, tx) : []),
		];
		const all = plan.sections.map((s) => s.module.name);
		return {
			sections,
			conflicts: unique(conflicts),
			notes: unique(notes),
			// as they stand for the dialog's first choice: keep extras, every section
			warnings: warningsFor(notes, false, all),
		};
	});
}

/**
 * The project as it is now, section by section, through each module's own
 * export: what the resources a rollback may keep hold. Plugins are left out:
 * their export reads every tarball, and a plugin's code is its own. A section
 * read only for warnings (no `uses`) that fails to export is skipped: a
 * warning must never stop a rollback.
 */
async function currentData(plan: RestorePlan, projectId: string) {
	const current = new Map<string, unknown>();
	for (const module of plan.modules) {
		if (module.name === "plugins" || module.name === "appConfig") continue;
		try {
			const { data } = await module.export({
				projectId,
				mode: "backup",
				options: { includeVersionHistory: false, includeAppConfigValues: false },
			});
			current.set(module.name, data);
		} catch (error) {
			if (module.uses) throw error;
			logger.warn(`[backup] rollback preview skipped ${module.name}: ${String(error)}`, "BACKUP");
		}
	}
	return current;
}

/**
 * Exact replica removes a section's extras. One that a resource the rollback
 * keeps still uses (a section left out, or one the archive doesn't hold) would
 * leave that resource broken, so it is refused, naming both. What the project
 * uses now is read through each module's own export.
 */
function brokenUses(plan: RestorePlan, current: Map<string, unknown>, sections: SectionChanges[]) {
	const extras = new Map(sections.map((s) => [s.section, new Set(s.extras)]));
	const conflicts: RollbackConflict[] = [];
	for (const module of plan.modules) {
		if (!module.uses || !current.has(module.name)) continue;
		for (const use of module.uses(current.get(module.name))) {
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

/** one of each: a message with several conditions keeps every one */
const unique = <T>(items: T[]) => [...new Map(items.map((i) => [JSON.stringify(i), i])).values()];

/**
 * The conflicts that stop a rollback with these choices, or the notes that
 * apply to it; the portal evaluates the same rule.
 */
export const activeConflicts = <T extends RollbackConflict>(
	conflicts: T[],
	prune: boolean,
	sections: string[],
) =>
	conflicts.filter(
		(c) =>
			c.mode === (prune ? "exact" : "keep") &&
			c.selected.every((s) => sections.includes(s)) &&
			c.kept.every((s) => !sections.includes(s)),
	);

/** the notes that apply to these choices, as restore warnings, each message once */
export const warningsFor = (notes: RollbackNote[], prune: boolean, sections: string[]) =>
	unique(
		activeConflicts(notes, prune, sections).map(({ section, message }) => ({ section, message })),
	);

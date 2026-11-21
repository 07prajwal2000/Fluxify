import { toSlug } from "@fluxify/lib";
import { SLUG_MAX } from "@fluxify/lib/slug";
import { checkProjectExists, isSlugTaken } from "../../api/v1/projects/create/repository";
import {
	announceNewProject,
	insertNewProject,
	recordProjectCreated,
} from "../../api/v1/projects/create/service";
import { db } from "../../db";
import { requestProjectCompile } from "../compiler/publisher";
import { BACKUP_MODULES } from "./modules";
import { type ArchiveSource, type RestorePlan, readBackup, restoreBackup } from "./restore";

/**
 * The largest archive a person can upload to make a project from (#1104).
 * Below Bun's own 128 MB request ceiling, which would otherwise answer first
 * with a bare 413. The archive is held in memory, as the engine holds it.
 */
export const MAX_ARCHIVE_UPLOAD_BYTES = 100 * 1024 * 1024;

export const COMPILE_NOT_QUEUED =
	"Compilation could not be queued; open the project and save any route to retry.";

/** `base`, or `base` with the first free numbered suffix, under `max` characters */
async function firstFree(
	base: string,
	max: number,
	suffix: (n: number) => string,
	taken: (v: string) => Promise<boolean>,
) {
	for (let n = 1; n < 100; n++) {
		const end = n === 1 ? "" : suffix(n);
		const value = base.slice(0, max - end.length).replace(/-+$/, "") + end;
		if (!(await taken(value))) return value;
	}
	return "";
}

/** what a checked archive holds, for the restore and rollback dialogs; never a secret */
export function summaryOf({ manifest, readme, warnings, sections }: RestorePlan) {
	return {
		mode: manifest.mode,
		release: manifest.release,
		createdAt: manifest.createdAt,
		source: manifest.source,
		sections: manifest.sections,
		encrypted: manifest.mode === "backup",
		readme,
		warnings,
		// what each section holds, read only, in import order
		preview: sections.map(({ module, data }) => ({
			section: module.name,
			items: module.preview?.(data, manifest.mode) ?? [],
		})),
	};
}

/**
 * What the archive holds, with every check a restore makes and nothing written:
 * the summary, the README and warnings to show before the user confirms, and a
 * name and slug for the new project that no project here has yet.
 */
export async function inspectArchive(bytes: Uint8Array | ArchiveSource) {
	const summary = summaryOf(await readBackup(bytes, BACKUP_MODULES));
	const { source } = summary;
	return {
		...summary,
		suggested: {
			name: await firstFree(
				source.name,
				50,
				(n) => ` (${n})`,
				(v) => checkProjectExists(v),
			),
			slug: await firstFree(
				toSlug(source.slug) || "project",
				SLUG_MAX,
				(n) => `-${n}`,
				(v) => isSlugTaken(v),
			),
		},
	};
}

/**
 * A new project from a backup or template archive (#1104; #1107 reuses it).
 * Checks the whole archive first, then creates the project through the same
 * path as "create project" and imports into it in one transaction. Once that
 * has committed, the project compile writes every artifact to the NATS store,
 * where dev and prod workers pick them up.
 */
export async function restoreProject(
	bytes: Uint8Array | ArchiveSource,
	{
		subdomain,
		...input
	}: Pick<Parameters<typeof insertNewProject>[0], "name" | "slug" | "description"> & {
		/** stands over the archive's own; one another project holds refuses the restore (409) */
		subdomain?: string;
	},
) {
	const plan = await readBackup(bytes, BACKUP_MODULES);
	const settings = subdomain ? { "settings.routing.subdomain": subdomain } : undefined;
	const { projectId, warnings } = await restoreBackup(plan, (work) =>
		db.transaction(async (tx) => {
			const created = await insertNewProject({ ...input, settings }, tx);
			await work(tx, created.projectId);
			// the last step: a failed publish rolls the project back
			await recordProjectCreated(created, "restore", ["name", "slug", plan.manifest.mode]);
			return created.projectId;
		}),
	);
	// a restored subdomain is a setting the compiler holds in memory
	await announceNewProject(
		projectId,
		plan.sections.some((s) => s.module.name === "projectSettings"),
	);
	if (!(await requestProjectCompile(projectId, "project restored")))
		warnings.push({ section: "project", message: COMPILE_NOT_QUEUED });
	return { projectId, warnings };
}

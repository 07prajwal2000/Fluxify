import { logger } from "@fluxify/common";
import type { DbTransactionType } from "../../db";
import { BadRequestError } from "../../errors/badRequestError";
import { openArchive, type Payload } from "./archive";
import type { BackupManifest } from "./manifest";
import { orderModules } from "./registry";
import { upgradeSection } from "./sections";
import type { BackupFiles, BackupModule, IdMap, ImportCtx, RestoreWarning } from "./types";

export type RestorePlan = {
	manifest: BackupManifest;
	/** the author's Markdown note, to show before the user confirms; null when there is none */
	readme: string | null;
	/** in import order, already upgraded and parsed */
	sections: { module: BackupModule; data: unknown; files: BackupFiles }[];
	/** every module this instance has, in import order, the archive's sections or not */
	modules: BackupModule[];
	/** what the modules' `inspect` found, to show before the user confirms */
	warnings: RestoreWarning[];
};

/**
 * Everything a restore checks, with nothing written: the archive, its hash,
 * the key, and every section's version and shape. A registered module whose
 * section is absent (an older backup, or one left out) imports nothing.
 * Each module's `inspect` adds its warnings to the plan.
 */
export async function readBackup(tgz: Uint8Array, modules: BackupModule[]): Promise<RestorePlan> {
	const { manifest, payload, readme } = await openArchive(tgz);
	const unknown = Object.keys(manifest.sections).find((n) => !modules.some((m) => m.name === n));
	if (unknown)
		throw new BadRequestError(
			`This backup holds a "${unknown}" section, which this version of Fluxify doesn't know. It was probably made by a newer version; update Fluxify to restore it.`,
		);

	const sections: RestorePlan["sections"] = [];
	const warnings: RestoreWarning[] = [];
	const read = (name: string) => sections.find((s) => s.module.name === name)?.data;
	const ordered = orderModules(modules);
	for (const module of ordered) {
		const version = manifest.sections[module.name];
		if (version === undefined) continue;
		const data = upgradeSection(module, version, readJson(payload, module.name));
		const files = filesOf(payload, module.name);
		sections.push({ module, data, files });
		for (const message of (await module.inspect?.(data, read, { files, mode: manifest.mode })) ??
			[])
			warnings.push({ section: module.name, message });
	}
	return { manifest, readme, sections, warnings, modules: ordered };
}

function readJson(payload: Payload, name: string): unknown {
	const bytes = payload.get(`sections/${name}.json`);
	try {
		if (bytes) return JSON.parse(new TextDecoder().decode(bytes));
	} catch {}
	throw new BadRequestError(
		`This backup is damaged: its "${name}" section is missing or unreadable.`,
	);
}

function filesOf(payload: Payload, name: string): BackupFiles {
	const prefix = `files/${name}/`;
	const files: BackupFiles = {};
	for (const [path, bytes] of payload)
		if (path.startsWith(prefix)) files[path.slice(prefix.length)] = bytes;
	return files;
}

/**
 * Opens one transaction, creates the new project in it (or, for a rollback,
 * locks the existing one), runs `work`, and returns the project's id. The
 * caller owns how a project is created (name, slug, members); the engine only
 * fills it.
 */
export type OpenProject = (
	work: (tx: DbTransactionType, projectId: string) => Promise<void>,
) => Promise<string>;

/**
 * A rollback into the project `OpenProject` hands over (#1130): only the
 * archive's `sections` named here are restored, each upserted by name, and with
 * `prune` (exact replica) what those sections' backup lacks is deleted.
 */
export type RollbackInto = { sections: string[]; prune: boolean; restoreSecrets: boolean };

/**
 * Imports a checked plan, each module in dependency order, in one transaction,
 * then runs the modules' `afterCommit` work. That work never fails the restore:
 * the project is already committed, and a retry would make a second one. A
 * failure is logged and its warning returned with the plan's.
 *
 * Without `into` the project is new and empty. With it, the project is a live
 * one: every module's resources are looked up by name first (`ctx.match`), so a
 * match keeps its id, and every reference to a section that isn't replaced
 * wholesale resolves to what the project has now.
 */
export async function restoreBackup(
	plan: RestorePlan,
	openProject: OpenProject,
	into?: RollbackInto,
): Promise<{ projectId: string; warnings: RestoreWarning[] }> {
	type Pending = RestoreWarning & { work: () => Promise<void> };
	let pending: Pending[] = [];
	let told: RestoreWarning[] = [];
	const chosen = into
		? plan.sections.filter((s) => into.sections.includes(s.module.name))
		: plan.sections;
	const projectId = await openProject(async (tx, projectId) => {
		// a retried transaction starts over
		pending = [];
		told = [];
		const ids = idMap();
		const existing = into ? await existingResources(plan, chosen, into, ids, tx, projectId) : null;
		const { mode, source } = plan.manifest;
		const ctxFor = (section: string): ImportCtx => ({
			tx,
			projectId,
			target: into ? "existing" : "new",
			prune: into?.prune ?? false,
			restoreSecrets: Boolean(into?.restoreSecrets) && mode === "backup",
			match: (name) => existing?.get(section)?.get(name),
			mode,
			source,
			files: {},
			ids,
			afterCommit: (work, message) => void pending.push({ section, message, work }),
			warn: (message) => void told.push({ section, message }),
		});
		for (const { module, data, files } of chosen)
			await module.import({ ...ctxFor(module.name), files }, data);
		if (into?.prune) await prune(chosen, existing!, ctxFor);
	});
	// a rollback says nothing about the sections it leaves alone
	const planned = into
		? plan.warnings.filter((w) => chosen.some((s) => s.module.name === w.section))
		: plan.warnings;
	const warnings = [...planned, ...told];
	for (const { work, ...warning } of pending)
		await work().catch((error) => {
			logger.error(`[backup] after restoring ${projectId}: ${String(error)}`, "BACKUP");
			warnings.push(warning);
		});
	return { projectId, warnings };
}

/**
 * Rollback: every module's resources in the project, name → id. Each is known
 * to `ids` up front, so a reference resolves to it, except in a section the
 * rollback replaces wholesale (exact replica), where only what the backup
 * brings back may be referenced: the rest is about to be deleted.
 */
async function existingResources(
	plan: RestorePlan,
	chosen: RestorePlan["sections"],
	into: RollbackInto,
	ids: IdMap,
	tx: DbTransactionType,
	projectId: string,
) {
	const existing = new Map<string, Map<string, string>>();
	for (const module of plan.modules) {
		if (!module.existing) continue;
		const found = await module.existing(projectId, tx);
		existing.set(module.name, found);
		const replaced = into.prune && chosen.some((s) => s.module === module);
		if (!replaced) for (const [name, id] of found) ids.set(module.name, name, id);
	}
	return existing;
}

/** exact replica: what each chosen section's backup lacks, last section first */
async function prune(
	chosen: RestorePlan["sections"],
	existing: Map<string, Map<string, string>>,
	ctxFor: (section: string) => ImportCtx,
) {
	for (const { module, data } of [...chosen].reverse()) {
		if (!module.prune || !module.names) continue;
		const kept = new Set(module.names(data));
		const stale = [...(existing.get(module.name) ?? [])]
			.filter(([name]) => !kept.has(name))
			.map(([name, id]) => ({ name, id }));
		await module.prune(ctxFor(module.name), stale, data);
	}
}

function idMap(): IdMap {
	const ids = new Map<string, string>();
	return {
		set: (section, name, id) => void ids.set(`${section}\0${name}`, id),
		get: (section, name) => ids.get(`${section}\0${name}`),
	};
}

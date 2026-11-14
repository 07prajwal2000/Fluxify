import { logger } from "@fluxify/common";
import type { DbTransactionType } from "../../db";
import { BadRequestError } from "../../errors/badRequestError";
import { openArchive, type Payload } from "./archive";
import type { BackupManifest } from "./manifest";
import { orderModules } from "./registry";
import { upgradeSection } from "./sections";
import type { BackupFiles, BackupModule, IdMap, RestoreWarning } from "./types";

export type RestorePlan = {
	manifest: BackupManifest;
	/** in import order, already upgraded and parsed */
	sections: { module: BackupModule; data: unknown; files: BackupFiles }[];
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
	const { manifest, payload } = await openArchive(tgz);
	const unknown = Object.keys(manifest.sections).find((n) => !modules.some((m) => m.name === n));
	if (unknown)
		throw new BadRequestError(
			`This backup holds a "${unknown}" section, which this version of Fluxify doesn't know. It was probably made by a newer version; update Fluxify to restore it.`,
		);

	const sections: RestorePlan["sections"] = [];
	const warnings: RestoreWarning[] = [];
	const read = (name: string) => sections.find((s) => s.module.name === name)?.data;
	for (const module of orderModules(modules)) {
		const version = manifest.sections[module.name];
		if (version === undefined) continue;
		const data = upgradeSection(module, version, readJson(payload, module.name));
		sections.push({ module, data, files: filesOf(payload, module.name) });
		for (const message of module.inspect?.(data, read) ?? [])
			warnings.push({ section: module.name, message });
	}
	return { manifest, sections, warnings };
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
 * Opens one transaction, creates the new project in it, runs `work`, and
 * returns the new project's id. The caller owns how a project is created
 * (name, slug, members); the engine only fills it.
 */
export type OpenProject = (
	work: (tx: DbTransactionType, projectId: string) => Promise<void>,
) => Promise<string>;

/**
 * Imports a checked plan into a new project, each module in dependency order, in
 * one transaction, then runs the modules' `afterCommit` work. That work never
 * fails the restore: the project is already committed, and a retry would make a
 * second one. A failure is logged and its warning returned with the plan's.
 */
export async function restoreBackup(
	plan: RestorePlan,
	openProject: OpenProject,
): Promise<{ projectId: string; warnings: RestoreWarning[] }> {
	type Pending = RestoreWarning & { work: () => Promise<void> };
	let pending: Pending[] = [];
	let told: RestoreWarning[] = [];
	const projectId = await openProject(async (tx, projectId) => {
		// a retried transaction starts over
		pending = [];
		told = [];
		const ids = idMap();
		const { mode } = plan.manifest;
		for (const { module, data, files } of plan.sections) {
			const section = module.name;
			const afterCommit = (work: () => Promise<void>, message: string) =>
				void pending.push({ section, message, work });
			const warn = (message: string) => void told.push({ section, message });
			await module.import({ tx, projectId, mode, files, ids, afterCommit, warn }, data);
		}
	});
	const warnings = [...plan.warnings, ...told];
	for (const { work, ...warning } of pending)
		await work().catch((error) => {
			logger.error(`[backup] after restoring ${projectId}: ${String(error)}`, "BACKUP");
			warnings.push(warning);
		});
	return { projectId, warnings };
}

function idMap(): IdMap {
	const ids = new Map<string, string>();
	return {
		set: (section, name, id) => void ids.set(`${section}\0${name}`, id),
		get: (section, name) => ids.get(`${section}\0${name}`),
	};
}

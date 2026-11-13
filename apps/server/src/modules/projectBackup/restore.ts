import { logger } from "@fluxify/common";
import type { DbTransactionType } from "../../db";
import { BadRequestError } from "../../errors/badRequestError";
import { openArchive, type Payload } from "./archive";
import type { BackupManifest } from "./manifest";
import { orderModules } from "./registry";
import { upgradeSection } from "./sections";
import type { BackupFiles, BackupModule, IdMap } from "./types";

export type RestorePlan = {
	manifest: BackupManifest;
	/** in import order, already upgraded and parsed */
	sections: { module: BackupModule; data: unknown; files: BackupFiles }[];
};

/**
 * Everything a restore checks, with nothing written: the archive, its hash,
 * the key, and every section's version and shape. A registered module whose
 * section is absent (an older backup, or one left out) imports nothing.
 */
export async function readBackup(tgz: Uint8Array, modules: BackupModule[]): Promise<RestorePlan> {
	const { manifest, payload } = await openArchive(tgz);
	const unknown = Object.keys(manifest.sections).find((n) => !modules.some((m) => m.name === n));
	if (unknown)
		throw new BadRequestError(
			`This backup holds a "${unknown}" section, which this version of Fluxify doesn't know. It was probably made by a newer version; update Fluxify to restore it.`,
		);

	const sections: RestorePlan["sections"] = [];
	for (const module of orderModules(modules)) {
		const version = manifest.sections[module.name];
		if (version === undefined) continue;
		const raw = readJson(payload, module.name);
		sections.push({
			module,
			data: upgradeSection(module, version, raw),
			files: filesOf(payload, module.name),
		});
	}
	return { manifest, sections };
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
 * second one. A failure is logged: the boot reconcile re-registers schedules,
 * and saving a trigger republishes it.
 */
export async function restoreBackup(plan: RestorePlan, openProject: OpenProject): Promise<string> {
	let pending: (() => Promise<void>)[] = [];
	const projectId = await openProject(async (tx, projectId) => {
		// a retried transaction starts over
		pending = [];
		const ids = idMap();
		const { mode } = plan.manifest;
		const afterCommit = (work: () => Promise<void>) => void pending.push(work);
		for (const { module, data, files } of plan.sections)
			await module.import({ tx, projectId, mode, files, ids, afterCommit }, data);
	});
	for (const work of pending)
		await work().catch((error) =>
			logger.error(`[backup] after restoring ${projectId}: ${String(error)}`, "BACKUP"),
		);
	return projectId;
}

function idMap(): IdMap {
	const ids = new Map<string, string>();
	return {
		set: (section, name, id) => void ids.set(`${section}\0${name}`, id),
		get: (section, name) => ids.get(`${section}\0${name}`),
	};
}

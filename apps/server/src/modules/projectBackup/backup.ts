import { BadRequestError } from "../../errors/badRequestError";
import { type Payload, writeArchive } from "./archive";
import { RELEASE } from "./manifest";
import type { BackupMode, BackupModule, BackupOptions, ExportCtx } from "./types";

export type CreateBackupInput = {
	projectId: string;
	/** the project's name and slug, shown before a restore */
	source: { name: string; slug: string };
	mode: BackupMode;
	options?: Partial<BackupOptions>;
	/** section names to include; every module when absent */
	sections?: string[];
};

/**
 * Builds the archive of a project. Pass `BACKUP_MODULES` (`modules.ts`); tests
 * pass their own. A section left out restores as empty.
 */
export async function createBackup(input: CreateBackupInput, modules: BackupModule[]) {
	const { projectId, source, mode, sections: selected } = input;
	const unknown = selected?.find((name) => !modules.some((m) => m.name === name));
	if (unknown) throw new BadRequestError(`There is no "${unknown}" section to back up.`);

	const options: BackupOptions = {
		includeVersionHistory: false,
		includeAppConfigValues: false,
		...input.options,
	};
	// a template never carries a secret, whatever was asked for
	if (mode === "template") options.includeAppConfigValues = false;
	const ctx: ExportCtx = { projectId, mode, options };

	const payload: Payload = new Map();
	const sections: Record<string, number> = {};
	for (const module of modules) {
		if (selected && !selected.includes(module.name)) continue;
		const { data, files } = await module.export(ctx);
		// parsed on the way out too, so a module can't write a section it would refuse to read
		const json = JSON.stringify(module.schema.parse(data));
		payload.set(`sections/${module.name}.json`, new TextEncoder().encode(json));
		for (const [path, bytes] of Object.entries(files ?? {}))
			payload.set(`files/${module.name}/${path}`, bytes);
		sections[module.name] = module.version;
	}
	return writeArchive(
		{ mode, release: RELEASE, createdAt: new Date().toISOString(), source, sections },
		payload,
	);
}

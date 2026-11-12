import { z } from "zod";
import { BadRequestError } from "../../errors/badRequestError";
import type { BackupModule } from "./types";

/**
 * One section of an archive brought to its module's current shape: refused
 * when it is newer than this instance knows or older than `minSupported`,
 * otherwise walked up one pure step at a time and parsed. Nothing is written
 * until every section has passed this.
 */
export function upgradeSection(module: BackupModule, version: number, raw: unknown): unknown {
	const { name } = module;
	if (version > module.version)
		throw new BadRequestError(
			`The "${name}" section was made by a newer version of Fluxify (format v${version}; this one reads up to v${module.version}). Update Fluxify to restore this backup.`,
		);
	if (version < module.minSupported) {
		const last = module.lastReleaseFor?.[version];
		throw new BadRequestError(
			`The "${name}" section is in format v${version}, which this version of Fluxify no longer restores (the oldest it reads is v${module.minSupported}). Restore it on ${last ? `Fluxify ${last}` : "an older Fluxify release"}, back that project up again, and restore the new backup here.`,
		);
	}

	let data = raw;
	try {
		for (let from = version; from < module.version; from++) data = module.upgrades[from]!(data);
	} catch (error) {
		throw new BadRequestError(
			`The "${name}" section of this backup could not be upgraded from format v${version}: ${(error as Error).message}`,
		);
	}
	const parsed = module.schema.safeParse(data);
	if (!parsed.success)
		throw new BadRequestError(
			`The "${name}" section of this backup is invalid: ${z.prettifyError(parsed.error)}`,
		);
	return parsed.data;
}

import { ConflictError } from "../../errors/conflictError";
import { NotFoundError } from "../../errors/notFoundError";
import { diffManifests } from "./diff";
import { pluginIntegrationUsers } from "./integrationUsage";
import { getPluginRow, type PluginRecord } from "./repository";
import { pluginUsage } from "./usage";

/**
 * An upgrade (#860): the pending version against the approved one it would
 * replace. A plugin never approved has nothing to replace, so every block of
 * it reads as added.
 */
export async function upgradeDiff(row: PluginRecord) {
	const from = row.live ?? (row.approval === "approved" ? row : null);
	const old = from?.manifest ?? { ...row.manifest, blocks: {}, integrations: [] };
	return {
		from: from && { version: from.version, integrity: from.integrity },
		to: { version: row.version, integrity: row.integrity },
		diff: diffManifests(
			old,
			row.manifest,
			await pluginUsage(row.projectId, row.name),
			await pluginIntegrationUsers(row.projectId, old),
		),
	};
}

export async function upgradePreview(projectId: string, name: string) {
	const row = await getPluginRow(projectId, name);
	if (!row) throw new NotFoundError(`Plugin ${name} is not installed in this project`);
	return upgradeDiff(row);
}

/** approval refuses an upgrade that takes away something the project uses (409 with the diff) */
export async function assertUpgradeSafe(row: PluginRecord) {
	if (!row.live) return;
	const preview = await upgradeDiff(row);
	if (!preview.diff.blocking) return;
	const error = new ConflictError(
		`Plugin ${row.name}@${row.version} cannot replace ${row.live.version}: ${preview.diff.blockers.join("; ")}. Remove those uses first.`,
	);
	error.details = { diff: preview.diff };
	throw error;
}

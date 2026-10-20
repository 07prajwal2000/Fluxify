import { db } from "../../db";
import { pluginsEntity } from "../../db/schema";
import { audit } from "../audit";
import { pluginInstallStatus } from "./installStatus";
import { listPluginRows, type PluginRecord, updatePluginRow } from "./repository";
import { getPlugin } from "./service";
import { checkSource } from "./sourceCheck";

/**
 * The plugin scanner (#861): checks one plugin's source, asks the workers how
 * its install went, and records `status`, `lastError` and `scannedAt`.
 *
 * A worker's error is written by `pluginInstallStatus` and starts with
 * `node `; every other error is the source's, so a source that is healthy
 * again clears its own error and never a worker's.
 */
const isNodeError = (row: PluginRecord) => row.lastError?.startsWith("node ") ?? false;

export async function scanPlugin(projectId: string, name: string) {
	const stored = await getPlugin(projectId, name);
	const problem = await checkSource(stored);
	// workers: pull-based, writes its own errors and clears them
	await pluginInstallStatus(projectId, name).catch(() => {});
	const row = await getPlugin(projectId, name);
	const values: Partial<PluginRecord> = { scannedAt: new Date() };
	if (problem) Object.assign(values, { status: "error", lastError: problem });
	else if (row.status === "error" && !isNodeError(row))
		Object.assign(values, { status: "ok", lastError: null });
	const updated = await updatePluginRow(row.id, values);
	if (updated.status !== row.status || updated.lastError !== row.lastError)
		await audit.record({
			projectId,
			resourceType: "plugin",
			resourceId: row.id,
			action: "update",
			changedFields: ["status", "lastError"],
			message: `scan: ${updated.lastError ?? "healthy again"}`,
		});
	return updated;
}

/** every plugin of a project */
export async function scanProject(projectId: string) {
	const scanned: PluginRecord[] = [];
	for (const { name } of await listPluginRows(projectId))
		scanned.push(await scanPlugin(projectId, name));
	return scanned;
}

/** the hourly job: every project's plugins */
export async function scanAllPlugins() {
	for (const { projectId, name } of await db
		.select({ projectId: pluginsEntity.projectId, name: pluginsEntity.name })
		.from(pluginsEntity))
		await scanPlugin(projectId, name).catch(() => {});
}

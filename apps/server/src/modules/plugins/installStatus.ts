import { type PluginInstallStatus, pluginStatusKey } from "@fluxify/common/orchestrator";
import { readLiveNodes } from "../orchestrator/status";
import { isUsableIn } from "./meta";
import { type PluginRecord, updatePluginRow } from "./repository";
import { getPlugin } from "./service";

/**
 * How far each worker got installing a plugin (#859), read from the node
 * heartbeats like a project's packages are. Only nodes in an environment the
 * plugin is enabled in count: the others were never asked to install it.
 */
const isCurrent = (
	status: PluginInstallStatus | null,
	row: { version: string; integrity: string },
) => status?.version === row.version && status.integrity === row.integrity;

export async function pluginInstallStatus(projectId: string, name: string) {
	const row = await getPlugin(projectId, name);
	const key = pluginStatusKey(projectId, name);
	const nodes = (await readLiveNodes())
		.filter((node) => node.projectId === projectId || node.projectId === "*")
		.filter((node) => isUsableIn(row, node.env === "development" ? "development" : "production"))
		.map((node) => ({
			nodeId: node.nodeId,
			type: node.type,
			env: node.env ?? "production",
			status: node.plugins?.[key] ?? null,
		}));
	const failed = nodes.find(
		(node) => node.status?.state === "error" && isCurrent(node.status, row),
	);
	const done = nodes.every((node) => isCurrent(node.status, row) && node.status?.state === "ready");
	await recordHealth(row, failed, nodes.length > 0 && done);
	return { version: row.version, integrity: row.integrity, done, failed: Boolean(failed), nodes };
}

/**
 * An error on any live node is the plugin's error, with the node named. It
 * clears once every node has installed the current version; until then (nodes
 * still installing, or none reporting) whatever is recorded stays, so an error
 * the scanner (P5) wrote is not wiped by a plugin nobody is running.
 */
async function recordHealth(
	row: PluginRecord,
	failed: { nodeId: string; status: PluginInstallStatus | null } | undefined,
	done: boolean,
) {
	if (failed) {
		const lastError = `node ${failed.nodeId}: ${failed.status?.error}`;
		if (row.status !== "error" || row.lastError !== lastError)
			await updatePluginRow(row.id, { status: "error", lastError });
	} else if (done && row.status === "error")
		await updatePluginRow(row.id, { status: "ok", lastError: null });
}

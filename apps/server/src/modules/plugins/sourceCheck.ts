import { join } from "node:path";
import { pluginObjects } from "../../db/natsObjects";
import { REGISTRY } from "../packages/registryUrl";
import type { PluginRecord } from "./repository";
import { hashFiles, sha256Integrity } from "./sources/integrity";
import { FETCH_TIMEOUT_MS } from "./sources/limits";
import { objectKeyOf } from "./sources/location";
import { pluginsRoot, readTree } from "./sources/tree";

/**
 * Whether the bytes behind a plugin are still the ones that were approved
 * (§6). Returns the anomaly as a sentence, or null when all is well. Report
 * only: nothing is re-pended or unloaded here. It never throws; a source that
 * cannot be reached is itself an anomaly.
 */
type Row = Pick<PluginRecord, "source" | "location" | "integrity" | "version" | "name">;

async function checkObject(row: Row) {
	const bytes = await (await pluginObjects()).get(objectKeyOf(row.location));
	if (!bytes)
		return `The stored tarball ${objectKeyOf(row.location)} is missing from the object store`;
	if (sha256Integrity(bytes) !== row.integrity)
		return `The stored tarball no longer matches the approved hash (${row.integrity})`;
	return null;
}

async function checkNpm(row: Row) {
	const res = await fetch(`${REGISTRY}/${row.name.replace("/", "%2f")}`, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (res.status === 404) return `${row.name} is no longer on the npm registry`;
	if (!res.ok) return `The registry answered ${res.status} for ${row.name}`;
	const packument = (await res.json()) as {
		versions?: Record<string, { dist?: { integrity?: string } }>;
	};
	const dist = packument.versions?.[row.version]?.dist;
	if (!dist) return `${row.name}@${row.version} is no longer on the npm registry`;
	if (dist.integrity !== row.integrity)
		return `The registry now lists a different hash for ${row.name}@${row.version}`;
	return null;
}

async function checkFs(row: Row) {
	const root = pluginsRoot();
	if (!root) return "No plugins directory is set (FLUXIFY_PLUGINS_DIR)";
	const hash = hashFiles(await readTree(join(root, row.location)));
	return hash === row.integrity
		? null
		: `The plugin directory '${row.location}' has changed since it was approved`;
}

export async function checkSource(row: Row): Promise<string | null> {
	try {
		if (row.source === "npm") return await checkNpm(row);
		if (row.source === "fs") return await checkFs(row);
		return await checkObject(row);
	} catch (error) {
		return `Could not check the source: ${(error as Error).message}`;
	}
}

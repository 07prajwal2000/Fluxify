import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getAppConfigKeysFromData } from "../../api/v1/integrations/create/service";
import { findProdPathClash } from "../../api/v1/routes/update/repository";
import { db } from "../../db";
import {
	type CanvasSnapshot,
	type CanvasVersionKind,
	type GateResult,
	integrationsEntity,
	middlewaresEntity,
} from "../../db/schema";
import { loadAppConfigFor } from "../../loaders/appconfigLoader";
import { configForEnv } from "../../loaders/integrationsLoader";
import { ensureCustomBlocksRegistered, snapshotGraph } from "../compiler/service";
import { compileDependencies } from "../packages/service";

/**
 * The checks a version passes before it goes to production (#739). Each returns
 * a `GateResult`; any `failed` one stops the deployment, and the log keeps all
 * of them. They are plain reads, so they are safe to run again.
 */

export type GateTarget = {
	kind: CanvasVersionKind;
	id: string;
	projectId: string;
	versionId: string;
	snapshot: CanvasSnapshot;
};

/** block data keys that hold an integration id */
const INTEGRATION_KEYS = new Set(["connection", "integrationId"]);
/** free text the user writes about a block; never a reference */
const NOTE_KEYS = new Set(["blockName", "blockDescription"]);
/** `getConfig("KEY")` in a block's JavaScript: how a block reads app config */
const GET_CONFIG = /getConfig\(\s*(["'`])([^"'`]+)\1\s*\)/g;

/**
 * What a block's data names, at any depth: the integrations it connects to, and
 * the app config keys it reads, as `cfg:KEY` or as `getConfig("KEY")`. A key
 * built at run time cannot be found, and is not guessed at.
 */
function referencesIn(data: unknown, found: { integrations: Set<string>; keys: Set<string> }) {
	if (typeof data !== "object" || data === null) return found;
	for (const [key, value] of Object.entries(data)) {
		if (NOTE_KEYS.has(key)) continue;
		if (typeof value === "string") {
			if (INTEGRATION_KEYS.has(key) && value) found.integrations.add(value);
			if (value.startsWith("cfg:")) found.keys.add(value.slice(4));
			for (const match of value.matchAll(GET_CONFIG)) found.keys.add(match[2]!);
		} else referencesIn(value, found);
	}
	return found;
}

/**
 * Every integration and app config key the version's blocks use must have a
 * value in production. An integration that was deleted since, or that has no
 * production config, fails it, and so does a key whose app config is gone.
 */
export async function valuesGate(target: GateTarget): Promise<GateResult> {
	const references = { integrations: new Set<string>(), keys: new Set<string>() };
	for (const block of target.snapshot.blocks) referencesIn(block.data, references);
	const ids = references.integrations;
	const keys = references.keys;

	const missing: string[] = [];
	const rows = ids.size
		? await db
				.select()
				.from(integrationsEntity)
				.where(
					and(
						inArray(integrationsEntity.id, [...ids]),
						// unowned rows are usable by every project
						or(
							eq(integrationsEntity.projectId, target.projectId),
							isNull(integrationsEntity.projectId),
						),
					),
				)
		: [];
	const found = new Map(rows.map((row) => [row.id, row]));
	for (const id of ids) {
		const row = found.get(id);
		if (!row) missing.push(`integration ${id} no longer exists`);
		else if (configForEnv(row, "production") === null)
			missing.push(`integration ${row.name} has no production value`);
		else for (const key of getAppConfigKeysFromData(row.config)) keys.add(key);
	}

	const { config } = await loadAppConfigFor("production", target.projectId);
	const have = config[target.projectId] ?? {};
	for (const key of [...keys].sort()) {
		if (!(key in have)) missing.push(`app config key ${key} has no production value`);
	}

	return missing.length
		? { gate: "values", status: "failed", message: "Production has no value for:", items: missing }
		: {
				gate: "values",
				status: "passed",
				message: "Every integration and app config key has a production value",
			};
}

/** No other route's promoted version may take this route's method and path. */
export async function pathGate(target: GateTarget): Promise<GateResult> {
	const { path, method } = target.snapshot.settings;
	if (!path || !method) return { gate: "path", status: "passed", message: "No path to check" };
	const clash = await findProdPathClash({ id: target.id, method, path });
	return clash
		? {
				gate: "path",
				status: "failed",
				message: `${method} ${clash.path} is already served in production by route "${clash.name}"`,
			}
		: { gate: "path", status: "passed", message: `${method} ${path} is free in production` };
}

/** Custom blocks and middlewares run their current state until #740 versions them. */
export async function customBlocksGate(target: GateTarget): Promise<GateResult> {
	const builtin = new Set<string>(Object.values(BlockTypes));
	const custom = new Set(
		target.snapshot.blocks.map((block) => block.type).filter((type) => !builtin.has(type)),
	);
	const middlewareIds = [
		...(target.snapshot.settings.middlewares?.before ?? []),
		...(target.snapshot.settings.middlewares?.after ?? []),
	];
	const middlewares = middlewareIds.length
		? await db
				.select({ name: middlewaresEntity.name })
				.from(middlewaresEntity)
				.where(inArray(middlewaresEntity.id, middlewareIds))
		: [];
	const items = [
		...[...custom].map((name) => `custom block ${name}`),
		...middlewares.map((row) => `middleware ${row.name}`),
	];
	return items.length
		? {
				gate: "custom_blocks",
				status: "warning",
				message:
					"Custom blocks and middlewares run their current state in production until custom block versions ship",
				items,
			}
		: { gate: "custom_blocks", status: "passed", message: "No custom blocks or middlewares used" };
}

/**
 * The version has to compile, or production would keep serving what it served
 * before while the log said otherwise. Compiling here changes nothing.
 */
export async function compileGate(target: GateTarget): Promise<GateResult> {
	try {
		await ensureCustomBlocksRegistered(target.projectId);
		const graph = snapshotGraph(target.snapshot);
		compileGraph(graph.blocks, graph.edges, {
			projectId: target.projectId,
			dependencies: await compileDependencies(target.projectId),
			asWorkflow: target.kind === "workflow",
		});
		return { gate: "compile", status: "passed", message: "The version compiles" };
	} catch (error) {
		return {
			gate: "compile",
			status: "failed",
			message: `The version does not compile: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/** Every gate but the tests: quick, so the request waits for them (see `testsGate`). */
export async function runChecks(target: GateTarget): Promise<GateResult[]> {
	return [
		await compileGate(target),
		await valuesGate(target),
		...(target.kind === "route" ? [await pathGate(target)] : []),
		await customBlocksGate(target),
	];
}

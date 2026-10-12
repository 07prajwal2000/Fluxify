import { compileGraph } from "@fluxify/blocks";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getAppConfigKeysFromData } from "../../api/v1/integrations/create/service";
import { findProdPathClash } from "../../api/v1/routes/update/repository";
import { db } from "../../db";
import {
	type CanvasSnapshot,
	type CanvasVersionKind,
	customBlocksListEntity,
	type GateResult,
	integrationsEntity,
	type MiddlewareSnapshot,
	type VersionSnapshot,
} from "../../db/schema";
import { loadAppConfigFor } from "../../loaders/appconfigLoader";
import { configForEnv } from "../../loaders/integrationsLoader";
import { ensureCustomBlocksRegistered, snapshotGraph } from "../compiler/service";
import { compileDependencies } from "../packages/service";
import { missingDependencies, type Uses } from "../references/closure";
import { loadProdGraph } from "../references/prodGraph";

/** * The checks a version passes before it goes to production (#739). Each returns
 * a `GateResult`; any `failed` one stops the deployment, and the log keeps all
 * of them. They are plain reads, so they are safe to run again.
 *
 * The same checks serve routes, workflows, custom blocks and middlewares (#740),
 * where they apply: a middleware has no integrations to check, and only a route
 * has a path.
 */

export type GateTarget = {
	kind: CanvasVersionKind;
	id: string;
	projectId: string;
	versionId: string;
	snapshot: VersionSnapshot;
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
	const { path, method } = (target.snapshot as CanvasSnapshot).settings;
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

/** what a version names: the custom blocks it calls, the middlewares it attaches, a chain it holds */
export function usesOfSnapshot(target: GateTarget): Uses {
	const { kind, snapshot } = target;
	const types = new Set(snapshot.blocks.map((block) => block.type));
	if (kind === "middleware") {
		return {
			blockTypes: [],
			middlewares: [],
			blockIds: (snapshot as MiddlewareSnapshot).settings.chain,
		};
	}
	const middlewares = (snapshot as CanvasSnapshot).settings.middlewares;
	return {
		blockTypes: types,
		middlewares:
			kind === "route" ? [...(middlewares?.before ?? []), ...(middlewares?.after ?? [])] : [],
		blockIds: [],
	};
}

/**
 * A version can only go live while everything it runs is live (#740): a route
 * that calls a custom block, or attaches a middleware, that has no production
 * version would answer "Custom block not loaded" on every request. The gate
 * follows uses of uses through promoted versions, and lists what is missing with
 * the ids the portal needs to promote each one first. A route's or workflow's
 * test hooks count: its production test runs call them.
 */
export async function customBlocksGate(target: GateTarget): Promise<GateResult> {
	const graph = await loadProdGraph(target.projectId);
	const uses = usesOfSnapshot(target);
	const hooks =
		target.kind === "route" || target.kind === "workflow"
			? graph.hookSuites.filter((suite) => suite.target.id === target.id).flatMap((s) => s.blockIds)
			: [];
	const selfIsBlock = target.kind === "custom_block" || target.kind === "middleware";
	const missing = missingDependencies(
		graph,
		{ ...uses, blockIds: [...uses.blockIds, ...hooks] },
		selfIsBlock ? target.id : undefined,
	);
	if (missing.length) {
		return {
			gate: "custom_blocks",
			status: "failed",
			message: `${missing.length} custom block${missing.length === 1 ? "" : "s or middlewares"} used here ${missing.length === 1 ? "has" : "have"} no production version yet, so this would fail in production. Promote ${missing.length === 1 ? "it" : "them"} first.`,
			items: missing.map(
				(dep) =>
					`${dep.kind === "middleware" ? "middleware" : "custom block"} "${dep.name}" has no production version`,
			),
			refs: missing.map((dep) => ({ kind: dep.kind, id: dep.id, name: dep.name })),
		};
	}
	const any =
		[...uses.blockTypes].some((type) => graph.blocksByName.has(type)) ||
		[...uses.middlewares].length > 0 ||
		[...uses.blockIds, ...hooks].length > 0;
	return any
		? {
				gate: "custom_blocks",
				status: "passed",
				message: "Every custom block and middleware it uses is live in production",
			}
		: { gate: "custom_blocks", status: "passed", message: "No custom blocks or middlewares used" };
}

/**
 * The version has to compile, or production would keep serving what it served
 * before while the log said otherwise. Compiling here changes nothing. A
 * middleware compiles when every block in its chain still exists.
 */
export async function compileGate(target: GateTarget): Promise<GateResult> {
	try {
		if (target.kind === "middleware") {
			await assertChainExists(target);
			return { gate: "compile", status: "passed", message: "The version compiles" };
		}
		await ensureCustomBlocksRegistered(target.projectId);
		const graph = snapshotGraph(target.snapshot);
		compileGraph(graph.blocks, graph.edges, {
			projectId: target.projectId,
			dependencies: await compileDependencies(target.projectId),
			asWorkflow: target.kind === "workflow",
			asCustomBlock: target.kind === "custom_block",
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

/** every block in a middleware's chain is a middleware block of this project, or the chain cannot run */
async function assertChainExists(target: GateTarget) {
	const chain = (target.snapshot as MiddlewareSnapshot).settings.chain;
	if (!chain.length) return;
	const rows = await db
		.select({ id: customBlocksListEntity.id, usage: customBlocksListEntity.usage })
		.from(customBlocksListEntity)
		.where(
			and(
				inArray(customBlocksListEntity.id, chain),
				eq(customBlocksListEntity.projectId, target.projectId),
			),
		);
	const gone = chain.filter(
		(id) => !rows.some((row) => row.id === id && row.usage === "middleware"),
	);
	if (gone.length) {
		throw new Error(
			`${gone.length} block${gone.length === 1 ? "" : "s"} in the chain no longer exist${gone.length === 1 ? "s" : ""}`,
		);
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

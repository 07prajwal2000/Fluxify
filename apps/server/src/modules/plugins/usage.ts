import { MODULE_BLOCK_DATA_KEYS } from "@fluxify/sdk";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import {
	blocksEntity,
	canvasVersionsEntity,
	customBlocksListEntity,
	edgesEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import { pluginIntegrationUsers } from "./integrationUsage";
import { getPluginRow } from "./repository";
import { pluginTriggerUsers, stringValues } from "./triggerUsage";

/**
 * Who uses a plugin (#860), node by node: the upgrade diff needs to know which
 * params, handles and invoke modes are in use, and removal is refused while
 * anything is listed. Working copies and promoted versions both count: a
 * promoted snapshot can call a block the working copy no longer has.
 *
 * Middlewares have no canvas (a chain of custom blocks), so they reach a
 * plugin only through a custom block, which is listed itself. Sandboxes are
 * not users, as for custom blocks (#740).
 */

export type PluginNodeUse = {
	type: string;
	blockId: string;
	where: "working_copy" | "production";
	/** params the node sets */
	params: string[];
	/** handles the node's edges are wired to: in, out and body */
	handles: string[];
	invoke: string;
	/** the string values it sets, by param: an integration param's id among them */
	values?: Record<string, string>;
};

export type PluginUser = {
	kind: "route" | "workflow" | "custom_block";
	id: string;
	name: string;
	inWorkingCopy: boolean;
	inProduction: boolean;
	nodes: PluginNodeUse[];
};

type Conn = DbTransactionType | typeof db;
type Node = { id: string; type: string | null; data: unknown };
type Edge = {
	from: string | null;
	to: string | null;
	fromHandle: string | null;
	toHandle: string | null;
};

const OWNERS = [
	{ kind: "route", table: routesEntity, column: blocksEntity.routeId },
	{ kind: "workflow", table: workflowsEntity, column: blocksEntity.workflowId },
	{ kind: "custom_block", table: customBlocksListEntity, column: blocksEntity.customBlockId },
] as const;

const handleName = (handle: string | null) =>
	handle ? handle.substring(handle.lastIndexOf("-") + 1) : undefined;

/** each plugin node of a canvas, with what it uses */
export function nodeUses(
	prefix: string,
	nodes: Node[],
	edges: Edge[],
	where: PluginNodeUse["where"],
): PluginNodeUse[] {
	const reserved: readonly string[] = MODULE_BLOCK_DATA_KEYS;
	return nodes
		.filter((n) => n.type?.startsWith(prefix))
		.map((n) => {
			const data = (n.data ?? {}) as Record<string, unknown>;
			const handles = new Set<string>();
			for (const e of edges) {
				const name =
					e.from === n.id
						? handleName(e.fromHandle)
						: e.to === n.id
							? handleName(e.toHandle)
							: undefined;
				if (name) handles.add(name);
			}
			return {
				type: n.type!,
				blockId: n.id,
				where,
				params: Object.keys(data)
					.filter(
						(k) =>
							!reserved.includes(k) && data[k] !== undefined && data[k] !== null && data[k] !== "",
					)
					.sort(),
				handles: [...handles].sort(),
				invoke: typeof data.invoke === "string" ? data.invoke : "sync",
				values: stringValues(data),
			};
		});
}

export async function pluginUsage(projectId: string, name: string, tx: Conn = db) {
	const prefix = `${name}/`;
	const users = new Map<string, PluginUser>();
	const add = (
		kind: PluginUser["kind"],
		id: string,
		label: string | null,
		nodes: PluginNodeUse[],
	) => {
		if (!nodes.length) return;
		const key = `${kind}:${id}`;
		const user = users.get(key) ?? {
			kind,
			id,
			name: label ?? id,
			inWorkingCopy: false,
			inProduction: false,
			nodes: [],
		};
		user.nodes.push(...nodes);
		if (nodes[0]!.where === "production") user.inProduction = true;
		else user.inWorkingCopy = true;
		users.set(key, user);
	};

	for (const { kind, table, column } of OWNERS) {
		// starts_with, not LIKE: `_` in a plugin name is a LIKE wildcard
		const nodes = await tx
			.select({
				id: blocksEntity.id,
				type: blocksEntity.type,
				data: blocksEntity.data,
				owner: table.id,
				name: table.name,
			})
			.from(blocksEntity)
			.innerJoin(table, eq(table.id, column))
			.where(
				and(eq(table.projectId, projectId), sql`starts_with(${blocksEntity.type}, ${prefix})`),
			);
		if (nodes.length) {
			const ids = nodes.map((n) => n.id);
			const edges = await tx
				.select()
				.from(edgesEntity)
				.where(or(inArray(edgesEntity.from, ids), inArray(edgesEntity.to, ids)));
			for (const [owner, own] of Map.groupBy(nodes, (n) => n.owner))
				add(kind, owner, own[0]!.name, nodeUses(prefix, own, edges, "working_copy"));
		}

		const snapshot = canvasVersionsEntity.snapshot;
		const promoted = await tx
			.select({
				id: table.id,
				name: table.name,
				blocks: sql<unknown>`${snapshot} -> 'blocks'`,
				edges: sql<unknown>`${snapshot} -> 'edges'`,
			})
			.from(table)
			.innerJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, table.prodVersionId))
			.where(
				and(
					eq(table.projectId, projectId),
					isNotNull(table.prodVersionId),
					sql`jsonb_path_exists(${snapshot}, '$.blocks[*] ? (@.type starts with $p)', jsonb_build_object('p', ${prefix}::text))`,
				),
			);
		for (const row of promoted)
			add(
				kind,
				row.id,
				row.name,
				nodeUses(prefix, asJson(row.blocks), asJson(row.edges), "production"),
			);
	}
	return [...users.values()].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
	);
}

/**
 * Everything the "Used by" panel lists for one plugin: its blocks on canvases,
 * the project's trigger rows of its kinds, and the integrations of its kinds.
 * A trigger and an integration are rows, not canvas nodes, so the upgrade diff
 * still reads them through its own users, not this.
 */
export async function pluginUsedBy(projectId: string, name: string) {
	const row = await getPluginRow(projectId, name);
	const [blocks, triggers, integrations] = await Promise.all([
		pluginUsage(projectId, name),
		pluginTriggerUsers(projectId, name),
		pluginIntegrationUsers(projectId, row?.manifest, row?.live?.manifest),
	]);
	return {
		blocks,
		triggers: triggers.map(({ id, name: triggerName, kind }) => ({
			id,
			name: triggerName,
			kind,
		})),
		integrations,
	};
}

/** a raw jsonb read may arrive as text */
const asJson = <T>(value: unknown): T[] =>
	((typeof value === "string" ? JSON.parse(value) : value) ?? []) as T[];

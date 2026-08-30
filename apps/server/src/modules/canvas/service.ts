import { BlockTypes } from "@fluxify/blocks";
import { db, type DbTransactionType } from "../../db";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { NotFoundError } from "../../errors/notFoundError";
import {
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_ROUTE_CHANGE,
	CHAN_ON_WORKFLOW_CHANGE,
	publishMessage,
} from "../../db/redis";
import {
	deleteBlocks,
	deleteEdges,
	deleteStructuralBlocks,
	getBlocks,
	getBlocksCountByType,
	getCustomBlockCalls,
	getCustomBlockNames,
	getProjectCustomBlocks,
	getEdges,
	parentExists,
	parentKeys,
	touchParent,
	upsertBlocks,
	upsertEdges,
} from "./repository";
import {
	findCycleEdgeIds,
	type DirectedCanvasEdge,
} from "./cycleDetection";
import type {
	CanvasChanges,
	CanvasParent,
	CanvasParentType,
} from "./types";

type CanvasEdgeWithHandle = DirectedCanvasEdge & {
	fromHandle?: string | null;
};

const CHANGE_CHANNEL = {
	route: CHAN_ON_ROUTE_CHANGE,
	custom_block: CHAN_ON_CUSTOM_BLOCK_CHANGE,
	workflow: CHAN_ON_WORKFLOW_CHANGE,
} as const satisfies Record<CanvasParentType, string>;

const NOT_FOUND = {
	route: "Route not found",
	custom_block: "Custom Block not found",
	workflow: "Workflow not found",
} as const satisfies Record<CanvasParentType, string>;

/**
 * An edge whose endpoint is neither in this payload nor already stored would
 * otherwise surface as a raw foreign key violation. Catch it here so every
 * caller gets the same readable error naming the block.
 */
async function assertEdgeTargetsExist(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	tx?: DbTransactionType,
) {
	const incoming = new Set(data.changes.blocks.map((b) => b.id));
	const referenced = new Set<string>();
	for (const edge of data.changes.edges) {
		for (const id of [edge.from, edge.to])
			if (!incoming.has(id)) referenced.add(id);
	}
	if (referenced.size === 0) return;

	// ponytail: reads every block of the canvas. Fine at canvas sizes; narrow to
	// a `where id in (...)` if a canvas ever gets big enough to notice.
	const stored = await getBlocks(parent, tx);
	const known = new Set(stored.map((b) => b.id));
	for (const id of deleteBlockIds) known.delete(id);

	const missing = [...referenced].filter((id) => !known.has(id));
	if (missing.length > 0) {
		throw new BadRequestError(
			`Edge references unknown block(s): ${missing.join(", ")}`,
		);
	}
}

/** Build the edge set that will exist after this delta is applied. */
async function canvasEdgesAfterSave(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	deleteEdgeIds: string[],
	tx: DbTransactionType,
) {
	const edges = new Map<string, CanvasEdgeWithHandle>(
		(await getEdges(parent, tx)).map((edge) => [
			edge.id,
			edge as CanvasEdgeWithHandle,
		]),
	);
	for (const edge of data.changes.edges)
		edges.set(edge.id, edge as CanvasEdgeWithHandle);
	for (const edgeId of deleteEdgeIds) edges.delete(edgeId);

	const deletedBlocks = new Set(deleteBlockIds);
	return [...edges.values()].filter(
		(edge) => !deletedBlocks.has(edge.from ?? "") && !deletedBlocks.has(edge.to ?? ""),
	);
}

async function assertCanvasHasNoCycles(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	deleteEdgeIds: string[],
	tx: DbTransactionType,
) {
	const cycleEdgeIds = findCycleEdgeIds(
		await canvasEdgesAfterSave(
			parent,
			data,
			deleteBlockIds,
			deleteEdgeIds,
			tx,
		),
	);
	if (cycleEdgeIds.size === 0) return;

	throw new ConflictError(
		`Canvas cannot contain cycles. Remove connection(s): ${[...cycleEdgeIds].join(", ")}`,
	);
}

/** The runtime takes the first edge it finds for an output handle. Rejecting
 * fan-out here protects every canvas writer, not only the AI harness. */
async function assertCanvasHasNoHandleFanOut(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	deleteEdgeIds: string[],
	tx: DbTransactionType,
) {
	const seen = new Map<string, string>();
	for (const edge of await canvasEdgesAfterSave(
		parent,
		data,
		deleteBlockIds,
		deleteEdgeIds,
		tx,
	)) {
		if (!edge.from) continue;
		const rawHandle = edge.fromHandle ?? "source";
		const handle = rawHandle.startsWith(`${edge.from}-`)
			? rawHandle.slice(edge.from.length + 1)
			: rawHandle;
		const key = `${edge.from}|${handle}`;
		const first = seen.get(key);
		if (first) {
			throw new BadRequestError(
				`Canvas has multiple outgoing edges on block ${edge.from}'s ${handle} handle (${first}, ${edge.id}).`,
			);
		}
		seen.set(key, edge.id);
	}
}

/**
 * A block whose type is neither a built-in nor one of the project's custom
 * blocks cannot be built — `BlockFactory` throws "Unknown block type" the first
 * time the route is hit. Storage used to take any string, so a typo (or an AI
 * agent using a near-miss name) was persisted and only surfaced at request time,
 * on a canvas that looked fine in the editor.
 */
async function assertBlockTypesExist(
	parent: CanvasParent,
	data: CanvasChanges,
	tx: DbTransactionType,
) {
	const builtin = new Set<string>(Object.values(BlockTypes));
	const unknown = [
		...new Set(
			data.changes.blocks.map((b) => b.type).filter((t) => !builtin.has(t)),
		),
	];
	if (unknown.length === 0) return;

	const custom = new Set(await getCustomBlockNames(parent, tx));
	const bad = unknown.filter((type) => !custom.has(type));
	if (bad.length === 0) return;

	throw new BadRequestError(
		`Unknown block type(s): ${bad.join(", ")}. Use a built-in block type or a custom block defined in this project.`,
	);
}

/**
 * A custom block that reaches itself — directly or through a chain of other
 * custom blocks — never terminates: `lib.invoke` would call into the block it is
 * already inside. The editor hides the block from its own picker, but a cycle
 * can still be closed from the other end (B gains a call to A while A already
 * calls B), so the save that closes it is refused here.
 *
 * Only runs for a custom block's own canvas; a route can call anything.
 */
async function assertNoCustomBlockRecursion(
	parent: CanvasParent,
	data: CanvasChanges,
	deleteBlockIds: string[],
	tx: DbTransactionType,
) {
	if (parent.type !== "custom_block") return;

	const blocks = await getProjectCustomBlocks(parent, tx);
	const self = blocks.find((b) => b.id === parent.id);
	if (!self) return;
	const nameById = new Map(blocks.map((b) => [b.id, b.name]));
	const names = new Set(blocks.map((b) => b.name));

	// this canvas as it will be once the delta lands; the rest as stored
	const deleted = new Set(deleteBlockIds);
	const incoming = new Set(data.changes.blocks.map((b) => b.id));
	const selfCalls = new Set(
		[
			...data.changes.blocks.map((b) => b.type),
			...(await getBlocks(parent, tx))
				.filter((b) => !deleted.has(b.id) && !incoming.has(b.id))
				.map((b) => b.type ?? ""),
		].filter((type) => names.has(type)),
	);

	const calls = new Map<string, Set<string>>([[self.name, selfCalls]]);
	for (const row of await getCustomBlockCalls(
		blocks.map((b) => b.id),
		tx,
	)) {
		const caller = nameById.get(row.parentId);
		if (!caller || caller === self.name || !names.has(row.type)) continue;
		const set = calls.get(caller) ?? new Set<string>();
		set.add(row.type);
		calls.set(caller, set);
	}

	// shortest path back to self, so the message names the actual chain
	const queue: string[][] = [[self.name]];
	const seen = new Set<string>();
	while (queue.length > 0) {
		const path = queue.shift()!;
		for (const callee of calls.get(path[path.length - 1]) ?? []) {
			if (callee === self.name) {
				throw new ConflictError(
					`Custom block "${self.name}" cannot call itself — recursion is not allowed (${[...path, callee].join(" → ")}).`,
				);
			}
			if (seen.has(callee)) continue;
			seen.add(callee);
			queue.push([...path, callee]);
		}
	}
}

/**
 * A verified agent run's canvas can arrive after the entrypoint/error handler
 * it means to replace already exist under different ids (e.g. the route was
 * created with its own defaults before this canvas landed). The agent's
 * output was already checked by the verifier, so when it settles on exactly
 * one block of the type, the stale one it did not know about is safe to drop
 * — along with any edge left dangling off it. Ambiguous cases (zero or more
 * than one incoming block of that type) are not resolved here; they fall
 * through to the same error a human duplicate would get.
 */
async function mergeStaleSingleton(
	parent: CanvasParent,
	data: CanvasChanges,
	type: string,
	tx: DbTransactionType,
) {
	const incomingIds = data.changes.blocks
		.filter((b) => b.type === type)
		.map((b) => b.id);
	if (incomingIds.length !== 1) return false;
	const [keepId] = incomingIds;

	const stored = await getBlocks(parent, tx);
	const staleIds = stored
		.filter((b) => b.type === type && b.id !== keepId)
		.map((b) => b.id);
	if (staleIds.length === 0) return false;

	const edges = await getEdges(parent, tx);
	const stale = new Set(staleIds);
	const staleEdgeIds = edges
		.filter((e) => stale.has(e.from ?? "") || stale.has(e.to ?? ""))
		.map((e) => e.id);

	await deleteStructuralBlocks(staleIds, tx);
	if (staleEdgeIds.length > 0) await deleteEdges(staleEdgeIds, tx);
	return true;
}

/**
 * The single source of truth for canvas mutations. Every caller — both HTTP
 * endpoints and the internal ops bus — goes through here, so a canvas is
 * changed exactly one way whatever it hangs off.
 *
 * Pass `outer` to join a transaction already in progress — that is how
 * "create the parent and its canvas or neither" is possible on the ops bus.
 * The change signal is then the outer caller's to publish, after it commits.
 *
 * `mergeAiDuplicates` is only ever set by the AI harness apply path (the ops
 * RPC bus) — see `mergeStaleSingleton`. A human-driven save always gets the
 * strict duplicate error.
 */
export async function saveCanvas(
	parent: CanvasParent,
	data: CanvasChanges,
	projectIds: string[] = [],
	outer?: DbTransactionType,
	mergeAiDuplicates = false,
) {
	if (!(await parentExists(parent, projectIds, outer))) {
		throw new NotFoundError(NOT_FOUND[parent.type]);
	}

	const keys = parentKeys(parent);
	const deleteBlockIds = data.actionsToPerform.blocks
		.filter((c) => c.action === "delete")
		.map((c) => c.id);
	const deleteEdgeIds = data.actionsToPerform.edges
		.filter((c) => c.action === "delete")
		.map((c) => c.id);

	// a tx nests as a savepoint, so the outer transaction still decides the outcome
	await (outer ?? db).transaction(async (tx) => {
		await assertBlockTypesExist(parent, data, tx);
		await assertNoCustomBlockRecursion(parent, data, deleteBlockIds, tx);
		await assertEdgeTargetsExist(parent, data, deleteBlockIds, tx);
		await assertCanvasHasNoCycles(
			parent,
			data,
			deleteBlockIds,
			deleteEdgeIds,
			tx,
		);
		await assertCanvasHasNoHandleFanOut(
			parent,
			data,
			deleteBlockIds,
			deleteEdgeIds,
			tx,
		);
		await upsertBlocks(
			data.changes.blocks.map((block) => ({ ...block, ...keys })),
			tx,
		);
		await upsertEdges(
			data.changes.edges.map((edge) => ({ ...edge, ...keys })),
			tx,
		);
		await deleteBlocks(deleteBlockIds, tx);
		await deleteEdges(deleteEdgeIds, tx);

		const structural = await getBlocksCountByType(
			parent,
			[BlockTypes.entrypoint, BlockTypes.errorHandler],
			tx,
		);
		await touchParent(parent, tx);
		for (const block of structural) {
			if (block.count === 1) continue;
			if (
				mergeAiDuplicates &&
				(await mergeStaleSingleton(parent, data, block.type!, tx))
			)
				continue;
			throw new BadRequestError(`Duplicate block ${block.type} found`);
		}
	});

	if (!outer) await publishMessage(CHANGE_CHANNEL[parent.type], parent.id);
}

export async function getCanvas(
	parent: CanvasParent,
	projectIds: string[] = [],
) {
	return await db.transaction(async (tx) => {
		if (!(await parentExists(parent, projectIds, tx))) {
			throw new NotFoundError(NOT_FOUND[parent.type]);
		}
		const [blocks, edges] = await Promise.all([
			getBlocks(parent, tx),
			getEdges(parent, tx),
		]);
		return {
			blocks: blocks.map((b) => ({
				id: b.id,
				type: b.type!,
				data: b.data as any,
				position: (b.position as { x: number; y: number }) ?? { x: 0, y: 0 },
			})),
			edges: edges.map((e) => ({
				id: e.id,
				from: e.from!,
				to: e.to!,
				fromHandle: e.fromHandle!,
				toHandle: e.toHandle!,
			})),
		};
	});
}

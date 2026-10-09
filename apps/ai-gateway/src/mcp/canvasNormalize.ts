import { FAN_OUT_HANDLES } from "@fluxify/blocks/blockHandles";
import { BlockTypes } from "@fluxify/blocks/blockTypes";
import { STARTER_POSITIONS } from "@fluxify/blocks/layout";
import { generateID } from "@fluxify/lib/random/id";
import type { canvasChangesSchema } from "@fluxify/server/src/modules/canvas/types";
import type { z } from "zod";

/**
 * What the model proposes is shaped the way it was asked for. The project's
 * own contract is different, so everything here turns one into the other.
 *
 * Three gaps this closes, all of which produce a broken canvas if skipped:
 *  - block ids: the prompt tells the agent to emit `block_1`, not a UUID
 *  - handle ids: edges persist `<blockId>-<kind>`, the agent emits bare `source`
 *  - block types: the agent may emit `errorHandler` where storage wants
 *    `error_handler`
 */

export type CanvasChanges = z.infer<typeof canvasChangesSchema>;

/** What the canvas currently holds, as `fluxify.ops.canvas` returns it. */
export type CanvasItems = {
	/** `key` is the block's readable name on its canvas (`response_1`) */
	blocks: {
		id: string;
		key?: string;
		type: string;
		data: unknown;
		position: { x: number; y: number };
	}[];
	edges: {
		id: string;
		from: string;
		to: string;
		fromHandle?: string | null;
		toHandle?: string | null;
	}[];
};

type AgentBlock = {
	id: string;
	blockType: string;
	blockName?: string | null;
	blockDescription?: string | null;
	data?: Record<string, unknown> | null;
	position?: { x?: number; y?: number } | null;
	connections?: { blockId: string; handle?: string | null }[] | null;
};

export type BlockBuilderPayload = {
	targetType?: "route" | "custom_block";
	targetId?: string;
	blocks?: AgentBlock[] | null;
	canvasChanges?: { type: string; data: any }[] | null;
};

/* ------------------------------------------------------------------ canvas */

/** `errorHandler` / `HTTP_Request` → the exact string storage stores. */
const CANONICAL_TYPE = new Map(
	Object.values(BlockTypes).map((type) => [key(type), type as string]),
);

function key(value: string) {
	return value.replace(/_/g, "").toLowerCase();
}

export function canonicalType(raw: string) {
	// A custom block instance stores the block's own name — the `custom:` prefix
	// is prompt syntax for "this one is custom" and has no meaning to storage or
	// to the block factory, so it is dropped here rather than persisted.
	if (raw.startsWith("custom:")) return raw.slice("custom:".length);
	return CANONICAL_TYPE.get(key(raw)) ?? raw;
}

/** Edges persist `<blockId>-<kind>`; the agent emits the bare kind. */
function fullHandle(blockId: string, handle: string | null | undefined, fallback: string) {
	const kind = (handle ?? fallback).trim() || fallback;
	return kind.startsWith(`${blockId}-`) ? kind : `${blockId}-${kind}`;
}

/**
 * One block-builder output plus the canvas it lands on, as a save-canvas
 * payload. `existing` decides which ids are real: anything the agent names that
 * is not already stored is a new block and gets a generated id, and every
 * reference to it is remapped to match.
 */
export function canvasChangesFromPayload(
	payload: BlockBuilderPayload,
	existing: CanvasItems,
): CanvasChanges {
	const storedIds = new Set(existing.blocks.map((b) => b.id));

	// entrypoint/errorHandler can only exist once per canvas. The agent has no
	// way to know the id storage already gave the route's default one, so if it
	// declares its own under a different id, map it onto the stored one instead
	// of minting a new one — otherwise saveCanvas's structural check rejects the
	// resulting duplicate.
	const SINGLETON_TYPES = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);
	const existingSingletonId = new Map<string, string>();
	for (const b of existing.blocks) {
		if (SINGLETON_TYPES.has(b.type)) existingSingletonId.set(b.type, b.id);
	}

	const changes = payload.canvasChanges ?? [];
	const edited: AgentBlock[] = changes
		.filter((c) => c?.type === "block_change")
		.flatMap((c) => (c.data?.blocksInfo ?? []) as AgentBlock[]);
	const declared = [...(payload.blocks ?? []), ...edited].filter((b) => b?.id);
	const rawTypeOf = new Map(declared.map((b) => [b.id, canonicalType(b.blockType ?? "")]));

	const minted = new Map<string, string>();
	const idFor = (raw: string) => {
		if (storedIds.has(raw)) return raw;
		const singleton = existingSingletonId.get(rawTypeOf.get(raw) ?? "");
		if (singleton) return singleton;
		let id = minted.get(raw);
		if (!id) {
			id = generateID();
			minted.set(raw, id);
		}
		return id;
	};

	const removed = new Set<string>();
	for (const change of changes) {
		if (change?.type !== "block_remove") continue;
		for (const id of (change.data?.blocks ?? []) as string[]) {
			if (storedIds.has(id)) removed.add(id);
		}
	}

	// An edge to a block that is neither stored nor declared has no endpoint to
	// point at; save-canvas would reject the whole payload for it.
	const known = new Set([...storedIds, ...declared.map((b) => b.id)]);

	const blocks = declared
		.filter((b) => !removed.has(b.id))
		.map((block) => ({
			id: idFor(block.id),
			type: canonicalType(block.blockType ?? ""),
			// name and description live inside `data` (see `baseBlockDataSchema`),
			// but the agent reports them as siblings of it
			data: {
				...(block.data ?? {}),
				...(block.blockName ? { blockName: block.blockName } : {}),
				...(block.blockDescription ? { blockDescription: block.blockDescription } : {}),
			},
			position: {
				x: Number(block.position?.x ?? 0),
				y: Number(block.position?.y ?? 0),
			},
		}));

	/**
	 * Blocks nothing may point at.
	 *
	 * A request enters at the entrypoint and the engine jumps to the error
	 * handler on failure — neither is reached by an edge, and the editor gives
	 * neither an inbound socket, so a user cannot draw one. An agent restating a
	 * whole canvas invents one anyway, and the cost is not cosmetic: the compiler
	 * has no codegen for an error handler reached as an ordinary block, so one
	 * such edge stops the entire route compiling with "No codegen for block type:
	 * error_handler".
	 */
	const inboundRefused = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);
	const typeById = new Map<string, string>([
		...existing.blocks.map((b) => [b.id, b.type] as const),
		...blocks.map((b) => [b.id, b.type] as const),
	]);
	const acceptsInbound = (id: string) => !inboundRefused.has(typeById.get(id) ?? "");

	const edges: CanvasChanges["changes"]["edges"] = [];
	const deletedEdgeIds = new Set<string>();
	const seen = new Set<string>();
	const storedEdgeId = new Map(
		existing.edges.map((e) => [`${e.from}|${e.fromHandle ?? ""}|${e.to}`, e.id]),
	);

	function addEdge(from: string, to: string, handle: string, id?: string) {
		const fromHandle = fullHandle(from, handle, "source");
		const toHandle = fullHandle(to, null, "target");
		const dedupe = `${from}|${fromHandle}|${to}`;
		if (seen.has(dedupe)) return;
		seen.add(dedupe);
		edges.push({
			// reuse the stored id so re-applying updates rather than duplicates
			id: id ?? storedEdgeId.get(dedupe) ?? generateID(),
			from,
			to,
			fromHandle,
			toHandle,
		});
	}

	/** A connection emitted for an existing source/handle replaces the old
	 * connection on that handle. The save API applies deltas, not whole edge
	 * lists, so omitting this deletion used to leave the old edge live beside the
	 * new one. */
	function replaceStoredHandle(from: string, handle: string, keepTo: string) {
		const fromHandle = fullHandle(from, handle, "source");
		// a fan-out handle (switch case, orchestrate) holds one edge per branch:
		// a new branch is added beside the others, never in place of them
		if (FAN_OUT_HANDLES.includes(fromHandle.slice(from.length + 1))) return;
		for (const edge of existing.edges) {
			if (edge.from !== from || (edge.fromHandle ?? "") !== fromHandle) continue;
			if (edge.to !== keepTo) deletedEdgeIds.add(edge.id);
		}
	}

	for (const block of declared) {
		if (removed.has(block.id)) continue;
		for (const connection of block.connections ?? []) {
			if (!connection?.blockId || !known.has(connection.blockId)) continue;
			if (removed.has(connection.blockId)) continue;
			const from = idFor(block.id);
			const to = idFor(connection.blockId);
			// Dropped before `replaceStoredHandle`: a refused edge must not take the
			// real connection on that handle down with it.
			if (!acceptsInbound(to)) continue;
			const handle = connection.handle ?? "source";
			// New blocks cannot have stale edges. For stored blocks, each declared
			// connection is an explicit replacement for its output handle.
			if (storedIds.has(from)) replaceStoredHandle(from, handle, to);
			addEdge(from, to, handle);
		}
	}

	for (const change of changes) {
		if (change?.type !== "edge_swap") continue;
		const { fromEdge, fromHandle, toEdge, toHandle } = change.data ?? {};
		if (!fromEdge || !toEdge || !known.has(fromEdge) || !known.has(toEdge)) continue;
		if (!acceptsInbound(idFor(toEdge))) continue;
		const from = idFor(fromEdge);
		const handle = fullHandle(from, fromHandle, "source");
		// Re-routing means the edge already off that handle now points elsewhere,
		// so keep its id: it is an update, not a second edge off one socket.
		const previous = existing.edges.find((e) => e.from === from && (e.fromHandle ?? "") === handle);
		replaceStoredHandle(from, fromHandle ?? "source", idFor(toEdge));
		// `toHandle` is ignored on purpose: every block has exactly one inbound
		// socket, so the target side is always `<to>-target`.
		void toHandle;
		addEdge(from, idFor(toEdge), fromHandle ?? "source", previous?.id);
	}

	// A create carrying blocks makes the server skip seeding the default
	// entrypoint/error handler (they would duplicate the agent's own), and the
	// agent does not reliably emit them — `find_resource` even stubs them as
	// already existing for a new route. Nothing then creates them and the canvas
	// has no entry point at all. Fill in whichever is missing on a new canvas.
	// (an empty payload seeds nothing: the server's own defaults still apply)
	if (existing.blocks.length === 0 && blocks.length > 0) {
		const present = new Set(blocks.map((b) => b.type));
		if (!present.has(BlockTypes.entrypoint)) {
			const id = generateID();
			const targeted = new Set(edges.map((e) => e.to));
			const head = blocks.find(
				(b) =>
					!targeted.has(b.id) &&
					b.type !== BlockTypes.errorHandler &&
					b.type !== BlockTypes.sticky_note,
			);
			blocks.unshift({
				id,
				type: BlockTypes.entrypoint,
				data: {},
				position: STARTER_POSITIONS.entrypoint,
			});
			if (head) addEdge(id, head.id, "source");
		}
		if (!present.has(BlockTypes.errorHandler)) {
			blocks.push({
				id: generateID(),
				type: BlockTypes.errorHandler,
				data: {},
				position: STARTER_POSITIONS.errorHandler,
			} as (typeof blocks)[number]);
		}
	}

	return {
		actionsToPerform: {
			blocks: [
				...blocks.map((b) => ({ id: b.id, action: "upsert" as const })),
				...[...removed].map((id) => ({ id, action: "delete" as const })),
			],
			// Edges of a removed block go with it (the FK cascades). Edges replaced
			// on a stored output handle must be explicitly deleted, however.
			edges: [
				...edges.map((e) => ({ id: e.id, action: "upsert" as const })),
				...[...deletedEdgeIds]
					.filter((id) => !edges.some((edge) => edge.id === id))
					.map((id) => ({ id, action: "delete" as const })),
			],
		},
		changes: { blocks, edges },
	};
}

/** Apply a canonical canvas delta in memory.  */
export function canvasAfterChanges(existing: CanvasItems, changes: CanvasChanges): CanvasItems {
	const deletedBlocks = new Set(
		changes.actionsToPerform.blocks
			.filter((action) => action.action === "delete")
			.map((action) => action.id),
	);
	const deletedEdges = new Set(
		changes.actionsToPerform.edges
			.filter((action) => action.action === "delete")
			.map((action) => action.id),
	);
	const blocks = new Map(
		existing.blocks
			.filter((block) => !deletedBlocks.has(block.id))
			.map((block) => [block.id, block]),
	);
	for (const block of changes.changes.blocks) blocks.set(block.id, block);

	const edges = new Map(
		existing.edges
			.filter(
				(edge) =>
					!deletedEdges.has(edge.id) &&
					!deletedBlocks.has(edge.from) &&
					!deletedBlocks.has(edge.to),
			)
			.map((edge) => [edge.id, edge]),
	);
	for (const edge of changes.changes.edges) edges.set(edge.id, edge);

	return { blocks: [...blocks.values()], edges: [...edges.values()] };
}

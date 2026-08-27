// Deep imports on purpose: the portal imports this module to preview a canvas
// output, and both barrels pull in Node built-ins (`vm`, pino) that break the
// browser build.
import { BlockTypes } from "@fluxify/blocks/blockTypes";
import { generateID } from "@fluxify/lib/random/id";
import type { canvasChangesSchema } from "@fluxify/server/src/modules/canvas/types";
import type { z } from "zod";

/**
 * Sub-agent output is written to `agent_harness_sub_artifacts` verbatim — it is
 * a record of what the model proposed, in the shape the model was asked for.
 * The project's own contract is different, so everything here turns one into
 * the other at apply time.
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
	blocks: { id: string; type: string; data: unknown; position: { x: number; y: number } }[];
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
	/**
	 * Materialized before persistence so the artifact preview shows the exact
	 * graph proposed against the canvas the agent read, rather than replaying a
	 * partial delta in the browser. Apply still re-materializes against the live
	 * canvas, because it may have changed while the artifact waited for review.
	 */
	preparedCanvas?: PreparedCanvas;
};

export type PreparedCanvas = {
	changes: CanvasChanges;
	preview: CanvasItems;
};

export type RouteConfigPayload = {
	action?: "create" | "delete" | "update-partial";
	routeId?: string | null;
	data?: {
		name?: string | null;
		method?: string | null;
		path?: string | null;
		bodySchema?: unknown;
		paramsSchema?: unknown;
		querySchema?: unknown;
		acceptedContentTypes?: string[] | null;
	} | null;
};

export type CustomBlockConfigPayload = {
	action?: "create" | "delete" | "update-partial";
	customBlockId?: string | null;
	data?: {
		name?: string | null;
		label?: string | null;
		description?: string | null;
		inputParams?: unknown[] | null;
	} | null;
};

/* ------------------------------------------------------------------ routes */

function normalizePath(path: string) {
	const trimmed = path.trim();
	const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	// the route regex rejects `//`, and a model joining segments produces it
	return rooted.replace(/\/{2,}/g, "/");
}

/** Drops keys the model left null — the create DTO treats null and absent
 *  differently, and `.optional()` rejects null. */
function compact<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
	);
}

/**
 * A route sub-artifact as the `fluxify.ops.route` subject wants it. `projectId`
 * comes from the request path, never from the payload — the agent does not get
 * to pick which project it writes to.
 */
export function routeOpFromPayload(payload: RouteConfigPayload, projectId: string) {
	const action = payload.action ?? "create";
	const data = payload.data ?? {};

	if (action === "delete") {
		if (!payload.routeId) throw new Error("Route delete output has no routeId");
		return { action: "delete" as const, id: payload.routeId };
	}

	const common = compact({
		name: data.name?.trim(),
		path: data.path ? normalizePath(data.path) : undefined,
		// the method enum is upper case; a model writing `get` is routine
		method: data.method?.trim().toUpperCase(),
	});

	// Schemas ride on an update too. They used to be dropped here — the update
	// subject took name/path/method only — so a run that correctly rewrote a
	// route's paramsSchema applied cleanly and changed nothing in the database.
	const schemas = compact({
		bodySchema: data.bodySchema,
		querySchema: data.querySchema,
		paramsSchema: data.paramsSchema,
		acceptedContentTypes: data.acceptedContentTypes,
	});

	if (action === "update-partial") {
		if (!payload.routeId) throw new Error("Route update output has no routeId");
		return {
			action: "modify" as const,
			id: payload.routeId,
			data: { ...common, ...schemas },
		};
	}

	return {
		action: "create" as const,
		data: { ...common, projectId, ...schemas },
	};
}

export function customBlockOpFromPayload(
	payload: CustomBlockConfigPayload,
	projectId: string,
) {
	const action = payload.action ?? "create";
	const data = payload.data ?? {};
	if (action === "delete") {
		if (!payload.customBlockId) throw new Error("Custom block delete output has no customBlockId");
		return { action: "delete" as const, id: payload.customBlockId };
	}
	// `compact` is shallow. The agent schema declares each param's `description`
	// and `variant` as `.nullish()`, the server DTO as `.optional()` — and
	// `.optional()` rejects null. An emitted `description: null` therefore rode
	// through to the bus and came back as "Malformed operation".
	const inputParams = data.inputParams?.map((param) =>
		compact((param ?? {}) as Record<string, unknown>),
	);
	const common = compact({
		label: data.label?.trim(),
		description: data.description?.trim(),
		inputParams,
	});
	if (action === "update-partial") {
		if (!payload.customBlockId) throw new Error("Custom block update output has no customBlockId");
		return { action: "modify" as const, id: payload.customBlockId, data: common };
	}
	if (!data.name?.match(/^[a-z0-9_]+$/)) {
		throw new Error("Custom block create output requires lowercase snake_case name");
	}
	return {
		action: "create" as const,
		data: { ...common, name: data.name, projectId, inputParams: inputParams ?? [] },
	};
}

/* ------------------------------------------------------------------ canvas */

/** `errorHandler` / `HTTP_Request` → the exact string storage stores. */
const CANONICAL_TYPE = new Map(
	Object.values(BlockTypes).map((type) => [key(type), type as string]),
);

function key(value: string) {
	return value.replace(/_/g, "").toLowerCase();
}

function canonicalType(raw: string) {
	// A custom block instance stores the block's own name — the `custom:` prefix
	// is prompt syntax for "this one is custom" and has no meaning to storage or
	// to the block factory, so it is dropped here rather than persisted.
	if (raw.startsWith("custom:")) return raw.slice("custom:".length);
	return CANONICAL_TYPE.get(key(raw)) ?? raw;
}

/**
 * Rewrites `custom:<old>` to `custom:<new>` everywhere a canvas payload names a
 * block type, for every entry in `renames`.
 *
 * A custom block's stored name is not always the name the run asked for — the
 * create endpoint namespaces it, and the config agent renames around a
 * collision. The caller's canvas invokes the block *by name*, so a canvas built
 * against the requested name resolves to nothing once the block lands under a
 * different one. The map is normally empty; this only does work when a name
 * actually moved between generation and apply.
 */
export function remapCustomBlockNames(
	payload: BlockBuilderPayload,
	renames: ReadonlyMap<string, string>,
): BlockBuilderPayload {
	if (renames.size === 0) return payload;

	const rename = (block: AgentBlock) => {
		const raw = block.blockType ?? "";
		if (!raw.startsWith("custom:")) return block;
		const to = renames.get(raw.slice("custom:".length));
		return to ? { ...block, blockType: `custom:${to}` } : block;
	};

	return {
		...payload,
		blocks: payload.blocks?.map(rename) ?? payload.blocks,
		canvasChanges: payload.canvasChanges?.map((change) =>
			change?.type === "block_change" && Array.isArray(change.data?.blocksInfo)
				? {
						...change,
						data: {
							...change.data,
							blocksInfo: (change.data.blocksInfo as AgentBlock[]).map(rename),
						},
					}
				: change,
		),
	};
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
				...(block.blockDescription
					? { blockDescription: block.blockDescription }
					: {}),
			},
			position: {
				x: Number(block.position?.x ?? 0),
				y: Number(block.position?.y ?? 0),
			},
		}));

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
		const from = idFor(fromEdge);
		const handle = fullHandle(from, fromHandle, "source");
		// Re-routing means the edge already off that handle now points elsewhere,
		// so keep its id: it is an update, not a second edge off one socket.
		const previous = existing.edges.find(
			(e) => e.from === from && (e.fromHandle ?? "") === handle,
		);
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
			blocks.unshift({ id, type: BlockTypes.entrypoint, data: {}, position: { x: 0, y: 0 } });
			if (head) addEdge(id, head.id, "source");
		}
		if (!present.has(BlockTypes.errorHandler)) {
			blocks.push({
				id: generateID(),
				type: BlockTypes.errorHandler,
				data: { next: "", retryAfterFail: false, retryCount: 0 },
				position: { x: -240, y: 0 },
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

/** Apply a canonical canvas delta in memory. Shared by artifact preparation
 * and the frontend preview so both see the same post-apply graph. */
export function canvasAfterChanges(
	existing: CanvasItems,
	changes: CanvasChanges,
): CanvasItems {
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

/** The runtime resolves only one edge per source handle. Keep this check close
 * to artifact materialization so an invalid graph never becomes a preview that
 * looks safe to approve. The canvas service repeats the invariant for all
 * writers at apply time. */
export function assertNoHandleFanOut(canvas: CanvasItems) {
	const edgeByHandle = new Map<string, string>();
	for (const edge of canvas.edges) {
		const rawHandle = edge.fromHandle ?? "source";
		const handle = rawHandle.startsWith(`${edge.from}-`)
			? rawHandle.slice(edge.from.length + 1)
			: rawHandle;
		const key = `${edge.from}|${handle}`;
		const first = edgeByHandle.get(key);
		if (first) {
			throw new Error(
				`Canvas has multiple outgoing edges on ${edge.from}'s ${handle} handle (${first}, ${edge.id}).`,
			);
		}
		edgeByHandle.set(key, edge.id);
	}
}

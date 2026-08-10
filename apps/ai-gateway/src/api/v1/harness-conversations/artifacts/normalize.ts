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

	if (action === "update-partial") {
		if (!payload.routeId) throw new Error("Route update output has no routeId");
		// update-partial takes name/path/method only; schemas are not editable
		// through it, and sending them would fail validation rather than apply.
		return { action: "modify" as const, id: payload.routeId, data: common };
	}

	return {
		action: "create" as const,
		data: {
			...common,
			projectId,
			...compact({
				bodySchema: data.bodySchema,
				querySchema: data.querySchema,
				paramsSchema: data.paramsSchema,
			}),
		},
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
	// custom blocks are named by the user, so only built-ins are mapped
	if (raw.startsWith("custom:")) return raw;
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

	for (const block of declared) {
		if (removed.has(block.id)) continue;
		for (const connection of block.connections ?? []) {
			if (!connection?.blockId || !known.has(connection.blockId)) continue;
			if (removed.has(connection.blockId)) continue;
			addEdge(idFor(block.id), idFor(connection.blockId), connection.handle ?? "source");
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
		// `toHandle` is ignored on purpose: every block has exactly one inbound
		// socket, so the target side is always `<to>-target`.
		void toHandle;
		addEdge(from, idFor(toEdge), fromHandle ?? "source", previous?.id);
	}

	return {
		actionsToPerform: {
			blocks: [
				...blocks.map((b) => ({ id: b.id, action: "upsert" as const })),
				...[...removed].map((id) => ({ id, action: "delete" as const })),
			],
			// edges of a removed block go with it (the FK cascades), so only
			// upserts are ever listed here
			edges: edges.map((e) => ({ id: e.id, action: "upsert" as const })),
		},
		changes: { blocks, edges },
	};
}

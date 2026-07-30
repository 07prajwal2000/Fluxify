export type ChangeAction = "upsert" | "delete";

/** Ids the server already knows about, per kind. */
export type KnownIds = { blocks: Iterable<string>; edges: Iterable<string> };

export type ChangeSet = {
	blocks: Map<string, ChangeAction>;
	edges: Map<string, ChangeAction>;
};

/** Detached copy — the tracker mutates its own maps in place. */
export function cloneChangeSet(changes: ChangeSet): ChangeSet {
	return { blocks: new Map(changes.blocks), edges: new Map(changes.edges) };
}

export type ChangeTracker = {
	/** Position moved, data edited, or newly added. */
	markUpserted: (kind: "blocks" | "edges", ids: Iterable<string>) => void;
	markDeleted: (kind: "blocks" | "edges", ids: Iterable<string>) => void;
	/** Forget everything and adopt a new set of server-known ids (after a save
	 *  or when a fresh graph is loaded). */
	reset: (known: KnownIds) => void;
	/** Live view of what would be sent. Do not mutate. */
	changes: ChangeSet;
	size: () => number;
};

/**
 * Records what changed so a save only ships the delta.
 *
 * All operations are O(1) per id (Map/Set), and blocks and edges are tracked in
 * separate maps so ids can never collide across kinds.
 *
 * Two rules the naive "does it still exist?" approach at save time gets wrong:
 * - A block created and then deleted before saving is dropped entirely — the
 *   server never saw it, so deleting it would be a bogus request.
 * - A server-known id that is deleted and re-added stays an `upsert`.
 */
export function createChangeTracker(known: KnownIds): ChangeTracker {
	let knownBlocks = new Set(known.blocks);
	let knownEdges = new Set(known.edges);
	const changes: ChangeSet = { blocks: new Map(), edges: new Map() };

	const knownFor = (kind: "blocks" | "edges") =>
		kind === "blocks" ? knownBlocks : knownEdges;

	return {
		markUpserted(kind, ids) {
			for (const id of ids) changes[kind].set(id, "upsert");
		},
		markDeleted(kind, ids) {
			for (const id of ids) {
				// Never persisted → nothing for the server to delete.
				if (!knownFor(kind).has(id)) changes[kind].delete(id);
				else changes[kind].set(id, "delete");
			}
		},
		reset(next) {
			knownBlocks = new Set(next.blocks);
			knownEdges = new Set(next.edges);
			changes.blocks.clear();
			changes.edges.clear();
		},
		changes,
		size: () => changes.blocks.size + changes.edges.size,
	};
}

import { useCallback, useMemo, useRef, useState } from "react";
import type { BlockEdge } from "../types";
import { createHistoryStack, type HistoryStack } from "./historyStack";

/**
 * What history tracks: block positions and the edge set. Block `data` is
 * deliberately excluded — editing a block's config is not undoable here.
 *
 * A snapshot covers the *whole* graph, so one entry undoes a bulk change (a
 * multi-select drag, a paste, a multi-edge delete) in a single step.
 */
export type CanvasSnapshot = {
	positions: Record<string, { x: number; y: number }>;
	edges: BlockEdge[];
};

export type CanvasHistory = {
	enabled: boolean;
	canUndo: boolean;
	canRedo: boolean;
	/** Record the current state as an undo point. Call *before* mutating. */
	commit: () => void;
	undo: () => void;
	redo: () => void;
	clear: () => void;
};

export type UseCanvasHistoryOptions = {
	enabled: boolean;
	/** Reads the current graph. */
	getSnapshot: () => CanvasSnapshot;
	/** Writes a snapshot back onto the graph. */
	applySnapshot: (snapshot: CanvasSnapshot) => void;
	/** Oldest entries are dropped past this many. */
	limit?: number;
};

const DEFAULT_LIMIT = 50;

export const DISABLED_HISTORY: CanvasHistory = {
	enabled: false,
	canUndo: false,
	canRedo: false,
	commit: () => {},
	undo: () => {},
	redo: () => {},
	clear: () => {},
};

/**
 * Undo/redo over graph snapshots. Kept free of React Flow specifics: the caller
 * supplies the read/write pair, which is what lets the AI panel or a diff view
 * reuse it against their own state.
 */
export function useCanvasHistory({
	enabled,
	getSnapshot,
	applySnapshot,
	limit = DEFAULT_LIMIT,
}: UseCanvasHistoryOptions): CanvasHistory {
	// The stack is mutable state, not render state; depth is mirrored into state
	// so the buttons re-render when it changes.
	const stackRef = useRef<HistoryStack<CanvasSnapshot> | null>(null);
	stackRef.current ??= createHistoryStack<CanvasSnapshot>(limit);
	const stack = stackRef.current;
	const [depth, setDepth] = useState({ past: 0, future: 0 });

	const sync = useCallback(() => setDepth(stack.sizes()), [stack]);

	const commit = useCallback(() => {
		if (!enabled) return;
		stack.commit(getSnapshot());
		sync();
	}, [enabled, stack, getSnapshot, sync]);

	const undo = useCallback(() => {
		if (!enabled) return;
		const previous = stack.undo(getSnapshot());
		if (!previous) return;
		applySnapshot(previous);
		sync();
	}, [enabled, stack, getSnapshot, applySnapshot, sync]);

	const redo = useCallback(() => {
		if (!enabled) return;
		const next = stack.redo(getSnapshot());
		if (!next) return;
		applySnapshot(next);
		sync();
	}, [enabled, stack, getSnapshot, applySnapshot, sync]);

	const clear = useCallback(() => {
		stack.clear();
		sync();
	}, [stack, sync]);

	return useMemo(
		() => ({
			enabled,
			canUndo: enabled && depth.past > 0,
			canRedo: enabled && depth.future > 0,
			commit,
			undo,
			redo,
			clear,
		}),
		[enabled, depth, commit, undo, redo, clear],
	);
}

import { useCallback, useMemo, useRef, useState } from "react";
import type { BlockEdge, BlockNode } from "../types";
import {
	cloneGraphPart,
	pickGraphPart,
	type GraphPart,
} from "./cloneGraphPart";

/** How far each paste/duplicate lands from the original, in graph units. */
export const PASTE_OFFSET = { x: 32, y: 32 };

export type CanvasClipboard = {
	enabled: boolean;
	/** True once something has been copied — for enabling a paste button. */
	canPaste: boolean;
	/** Copies the given blocks, or the selection when called with nothing.
	 *  Returns how many blocks were taken. */
	copy: (blockIds?: Iterable<string>) => number;
	/** Inserts the copied slice with fresh ids, offset from the originals. */
	paste: () => void;
	/** Copy + paste in one step, without touching the clipboard. */
	duplicate: (blockIds: Iterable<string>) => void;
};

export type UseClipboardOptions = {
	enabled: boolean;
	/** Reads the live graph — a ref read, so the callbacks stay stable. */
	getGraph: () => { nodes: BlockNode[]; edges: BlockEdge[] };
	/** Adds the clones to the canvas (history, tracking and state are its job). */
	insert: (part: GraphPart) => void;
};

/**
 * Copy/paste/duplicate over graph slices. The clipboard is in-memory and local to
 * the canvas: nothing is read from or written to the system clipboard, so copying
 * can never pick up unrelated content.
 */
export function useClipboard({
	enabled,
	getGraph,
	insert,
}: UseClipboardOptions): CanvasClipboard {
	const held = useRef<GraphPart | null>(null);
	const [canPaste, setCanPaste] = useState(false);
	// Repeated pastes of the same slice must not stack on top of each other.
	const pastes = useRef(0);

	const copy = useCallback(
		(blockIds?: Iterable<string>) => {
			if (!enabled) return 0;
			const { nodes, edges } = getGraph();
			const part = pickGraphPart(nodes, edges, blockIds);
			held.current = part.nodes.length > 0 ? part : null;
			pastes.current = 0;
			setCanPaste(part.nodes.length > 0);
			return part.nodes.length;
		},
		[enabled, getGraph],
	);

	const paste = useCallback(() => {
		const part = held.current;
		if (!enabled || !part) return;
		pastes.current += 1;
		insert(
			cloneGraphPart(part, {
				offset: {
					x: PASTE_OFFSET.x * pastes.current,
					y: PASTE_OFFSET.y * pastes.current,
				},
				select: true,
			}),
		);
	}, [enabled, insert]);

	const duplicate = useCallback(
		(blockIds: Iterable<string>) => {
			if (!enabled) return;
			const { nodes, edges } = getGraph();
			const part = pickGraphPart(nodes, edges, blockIds);
			if (part.nodes.length === 0) return;
			insert(cloneGraphPart(part, { offset: PASTE_OFFSET, select: true }));
		},
		[enabled, getGraph, insert],
	);

	return useMemo(
		() => ({ enabled, canPaste: enabled && canPaste, copy, paste, duplicate }),
		[enabled, canPaste, copy, paste, duplicate],
	);
}

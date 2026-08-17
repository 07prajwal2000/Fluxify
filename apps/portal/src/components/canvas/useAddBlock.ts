import { useCallback, useRef, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { BLOCK_TYPES, canAddBlock, type BlockType } from "./blocks";
import { defaultBlockData } from "./blocks/defaultBlockData";
import { newStickyNoteData } from "./blocks/stickyNoteData";
import { uuidv7 } from "./ids";
import type { BlockNode } from "./types";

/** A point in viewport coordinates — a click, not a graph position. */
export type ScreenPoint = { x: number; y: number };

export type UseAddBlockOptions = {
	readOnly: boolean;
	/** Used to centre a block when the caller names no point. */
	canvasRef: RefObject<HTMLDivElement | null>;
	/** Records the undo point and marks the new block for saving. */
	onBeforeAdd: (blockId: string) => void;
	addNode: (node: BlockNode) => void;
	openPicker: () => void;
};

export type AddBlock = {
	/** Adds a block at `at`, or in the middle of the canvas without one. */
	addBlock: (type: BlockType, at?: ScreenPoint) => void;
	/** Opens the picker, remembering where its block should land. */
	openPickerAt: (at?: ScreenPoint) => void;
	/** Adds the picked block at the point the picker was opened from. */
	addPickedBlock: (type: BlockType) => void;
};

/**
 * Creating blocks, and remembering where they go.
 *
 * The picker is a sidebar, so the block arrives long after the right-click that
 * asked for it — the point has to survive that gap or every picked block lands
 * in the middle of the canvas instead of under the pointer.
 */
export function useAddBlock({
	readOnly,
	canvasRef,
	onBeforeAdd,
	addNode,
	openPicker,
}: UseAddBlockOptions): AddBlock {
	const { screenToFlowPosition } = useReactFlow();
	const dropPoint = useRef<ScreenPoint | null>(null);

	const canvasCenter = useCallback((): ScreenPoint => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		return bounds
			? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
			: { x: window.innerWidth / 2, y: window.innerHeight / 2 };
	}, [canvasRef]);

	const addBlock = useCallback(
		(type: BlockType, at?: ScreenPoint) => {
			if (readOnly || !canAddBlock(type)) return;
			const noteData =
				type === BLOCK_TYPES.stickynote ? newStickyNoteData() : undefined;
			const node: BlockNode = {
				id: uuidv7(),
				type,
				position: screenToFlowPosition(at ?? canvasCenter()),
				data: noteData ?? defaultBlockData(type),
				width: noteData?.size.width,
				height: noteData?.size.height,
				zIndex: type === BLOCK_TYPES.stickynote ? -1 : 0,
				selected: true,
			};
			onBeforeAdd(node.id);
			addNode(node);
		},
		[readOnly, screenToFlowPosition, canvasCenter, onBeforeAdd, addNode],
	);

	const openPickerAt = useCallback(
		(at?: ScreenPoint) => {
			dropPoint.current = at ?? null;
			openPicker();
		},
		[openPicker],
	);

	const addPickedBlock = useCallback(
		(type: BlockType) => {
			addBlock(type, dropPoint.current ?? undefined);
			dropPoint.current = null;
		},
		[addBlock],
	);

	return { addBlock, openPickerAt, addPickedBlock };
}

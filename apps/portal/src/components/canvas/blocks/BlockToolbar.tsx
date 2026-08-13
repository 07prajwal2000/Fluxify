import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	TbClipboardCopy,
	TbCopy,
	TbExternalLink,
	TbTrash,
} from "react-icons/tb";
import { useCanvasChanges } from "../changes/ChangesContext";
import { useCanvasClipboard } from "../clipboard/ClipboardContext";
import { useCanvasPanel } from "../panel/PanelContext";

/** Hover must be deliberate — the toolbar would flicker on every pass-over. */
export const TOOLBAR_OPEN_DELAY_MS = 250;
/** …and must survive the trip from the block to the toolbar itself. */
export const TOOLBAR_CLOSE_DELAY_MS = 150;

export type HoverIntent = {
	hovered: boolean;
	/** Spread on every element that should keep the toolbar open. */
	hoverProps: {
		onMouseEnter: () => void;
		onMouseLeave: () => void;
	};
};

/** Delayed hover state, shared by the block and its toolbar. */
export function useHoverIntent(
	openDelay = TOOLBAR_OPEN_DELAY_MS,
	closeDelay = TOOLBAR_CLOSE_DELAY_MS,
): HoverIntent {
	const [hovered, setHovered] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const schedule = useCallback((value: boolean, delay: number) => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setHovered(value), delay);
	}, []);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return useMemo(
		() => ({
			hovered,
			hoverProps: {
				onMouseEnter: () => schedule(true, openDelay),
				onMouseLeave: () => schedule(false, closeDelay),
			},
		}),
		[hovered, schedule, openDelay, closeDelay],
	);
}

export type BlockToolbarProps = {
	blockId: string;
	visible: boolean;
	/** System-owned blocks can still be opened, but cannot be copied or removed. */
	allowMutatingActions?: boolean;
	/** Keeps the toolbar open while the pointer is on it. */
	hoverProps?: HoverIntent["hoverProps"];
};

/**
 * The action strip above a block: open, duplicate, copy, delete. It lives inside
 * the node rather than in a `NodeToolbar`, so it scales with the canvas zoom like
 * the block it belongs to. Hidden in readonly mode.
 */
export function BlockToolbar({
	blockId,
	visible,
	allowMutatingActions = true,
	hoverProps,
}: BlockToolbarProps) {
	const { deleteElements } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const clipboard = useCanvasClipboard();
	const panel = useCanvasPanel();

	// deleteElements (unlike setNodes) reports through onNodesChange, so the
	// deletion is tracked and undoable like any other.
	const onDelete = useCallback(() => {
		void deleteElements({ nodes: [{ id: blockId }] });
	}, [blockId, deleteElements]);

	// The selection when there is one, this block alone otherwise.
	const onCopy = useCallback(() => {
		if (clipboard.copy() === 0) clipboard.copy([blockId]);
	}, [blockId, clipboard]);

	if (!visible) return null;

	return (
		// nodrag: pressing a button must not start dragging the block.
		<div className="fx-block__toolbar nodrag" {...hoverProps}>
			{panel.enabled && (
				<button
					type="button"
					className="fx-block__action"
					title="Open"
					aria-label="Open block"
					onClick={() => panel.open(blockId)}
				>
					<TbExternalLink />
				</button>
			)}
			{editable && allowMutatingActions && clipboard.enabled && (
				<>
					<button
						type="button"
						className="fx-block__action"
						title="Duplicate"
						aria-label="Duplicate block"
						onClick={() => clipboard.duplicate([blockId])}
					>
						<TbCopy />
					</button>
					<button
						type="button"
						className="fx-block__action"
						title="Copy"
						aria-label="Copy block"
						onClick={onCopy}
					>
						<TbClipboardCopy />
					</button>
				</>
			)}
			{editable && allowMutatingActions && (
				<button
					type="button"
					className="fx-block__action fx-block__action--danger"
					title="Delete"
					aria-label="Delete block"
					onClick={onDelete}
				>
					<TbTrash />
				</button>
			)}
		</div>
	);
}

import { ControlButton } from "@xyflow/react";
import { TbArrowBackUp, TbArrowForwardUp } from "react-icons/tb";
import { useCanvasHistoryContext } from "./HistoryContext";

/**
 * Undo/redo buttons. Render inside React Flow's `<Controls>` so they sit next to
 * the zoom buttons and inherit their styling.
 */
export function HistoryControls() {
	const { enabled, canUndo, canRedo, undo, redo } = useCanvasHistoryContext();
	if (!enabled) return null;

	return (
		<>
			<ControlButton
				onClick={undo}
				disabled={!canUndo}
				title="Undo (Ctrl+Z)"
				aria-label="Undo"
			>
				<TbArrowBackUp />
			</ControlButton>
			<ControlButton
				onClick={redo}
				disabled={!canRedo}
				title="Redo (Ctrl+Y)"
				aria-label="Redo"
			>
				<TbArrowForwardUp />
			</ControlButton>
		</>
	);
}

import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import type { ReactNode } from "react";
import {
	TbArrowBackUp,
	TbLock,
	TbLockOpen,
} from "react-icons/tb";
import {
	MdFormatPaint,
	MdOutlineFitScreen,
	MdZoomIn,
	MdZoomOut,
} from "react-icons/md";
import { useCanvasHistoryContext } from "./history";
import { useCanvasFormat } from "./layout";

type CanvasToolbarProps = {
	readOnly: boolean;
	layoutLocked: boolean;
	onToggleLayoutLock: () => void;
};

type ToolbarButtonProps = {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	pressed?: boolean;
	children: ReactNode;
};

function ToolbarButton({
	label,
	onClick,
	disabled = false,
	pressed,
	children,
}: ToolbarButtonProps) {
	return (
		<button
			type="button"
			className="fx-canvas-toolbar__button"
			title={label}
			aria-label={label}
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

/** Portal-native canvas controls. Kept separate from React Flow's stock toolbar
 * so the product owns both its actions and visual language. */
export function CanvasToolbar({
	readOnly,
	layoutLocked,
	onToggleLayoutLock,
}: CanvasToolbarProps) {
	const { fitView, setViewport, zoomIn, zoomOut } = useReactFlow();
	const viewport = useViewport();
	const history = useCanvasHistoryContext();
	const format = useCanvasFormat();

	return (
		<Panel position="bottom-left" className="fx-canvas-toolbar">
			<div className="fx-canvas-toolbar__group">
				<ToolbarButton label="Zoom out" onClick={() => void zoomOut({ duration: 150 })}>
					<MdZoomOut />
				</ToolbarButton>
				<button
					type="button"
					className="fx-canvas-toolbar__zoom"
					title="Reset zoom to 100%"
					aria-label="Reset zoom to 100%"
					onClick={() => void setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 150 })}
				>
					{Math.round(viewport.zoom * 100)}%
				</button>
				<ToolbarButton label="Zoom in" onClick={() => void zoomIn({ duration: 150 })}>
					<MdZoomIn />
				</ToolbarButton>
				<ToolbarButton label="Fit canvas to view" onClick={() => void fitView({ padding: 0.2, duration: 200 })}>
					<MdOutlineFitScreen />
				</ToolbarButton>
			</div>

			<div className="fx-canvas-toolbar__divider" />

			<div className="fx-canvas-toolbar__group">
				<ToolbarButton
					label="Undo"
					disabled={!history.enabled || !history.canUndo}
					onClick={history.undo}
				>
					<TbArrowBackUp />
				</ToolbarButton>
				<ToolbarButton
					label="Redo"
					disabled={!history.enabled || !history.canRedo}
					onClick={history.redo}
				>
					<TbArrowBackUp className="-scale-x-100" />
				</ToolbarButton>
				<ToolbarButton
					label="Format blocks"
					disabled={!format.enabled || format.isFormatting || layoutLocked}
					onClick={() => void format.format()}
				>
					<MdFormatPaint />
				</ToolbarButton>
				<ToolbarButton
					label={layoutLocked ? "Unlock canvas layout" : "Lock canvas layout"}
					disabled={readOnly}
					pressed={layoutLocked}
					onClick={onToggleLayoutLock}
				>
					{layoutLocked ? <TbLock /> : <TbLockOpen />}
				</ToolbarButton>
			</div>

		</Panel>
	);
}

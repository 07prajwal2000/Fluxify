import type { useBlockPanelResize } from "./useBlockPanelResize";

/** The drag handle on a side panel's left edge: drag to resize, double-click to reset, arrow keys too. */
export function PanelResizeHandle({
	label,
	resize,
}: {
	label: string;
	resize: ReturnType<typeof useBlockPanelResize>;
}) {
	return (
		<div
			className="fx-panel__resize-handle"
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={Math.round(resize.width)}
			aria-valuemin={Number.isFinite(resize.minWidth) ? resize.minWidth : 0}
			aria-valuemax={Number.isFinite(resize.maxWidth) ? resize.maxWidth : 9999}
			onMouseDown={resize.handleMouseDown}
			onTouchStart={resize.handleTouchStart}
			onDoubleClick={resize.handleDoubleClick}
			onKeyDown={resize.handleKeyDown}
			title="Drag to resize panel (double-click to reset)"
		>
			<div className="fx-panel__resize-knob">
				<svg
					width="6"
					height="12"
					viewBox="0 0 6 12"
					fill="currentColor"
					aria-hidden="true"
					className="fx-panel__resize-icon"
				>
					<rect x="0" y="0" width="2" height="12" rx="1" />
					<rect x="4" y="0" width="2" height="12" rx="1" />
				</svg>
			</div>
		</div>
	);
}

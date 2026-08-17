import { useRef } from "react";
import { TbChevronsRight } from "react-icons/tb";
import "./panel.css";
import { BlockSettings } from "./BlockSettings";
import { blockSettingsTabs } from "./blockSettingsRegistry";
import { useBlockPanelResize } from "./useBlockPanelResize";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { blockIcon } from "../blocks/blockIconMap";
import { blockLabels } from "../blocks/blockLabels";
import { useCustomBlockDefs } from "../blocks/useCustomBlockDefs";
import type { BlockNode } from "../types";

export type BlockPanelProps = {
	/** Block to show, or `null` to slide the panel out. */
	block: BlockNode | null;
	onClose: () => void;
	/** Rendered under the tabs — the AI prompt and anything else app-level. */
	children?: React.ReactNode;
	/** Initial/default width in px when no width is saved in storage. */
	defaultWidth?: number;
	/** Minimum width constraint (defaults to 0 for unconstrained/infinite). */
	minWidth?: number;
	/** Maximum width constraint (defaults to Infinity for unconstrained/infinite). */
	maxWidth?: number;
	/** localStorage key for saving panel width across reopens. */
	storageKey?: string;
};

/**
 * Side panel for the block that was opened: what it is, and its settings. The
 * settings themselves are tabs — General plus whatever the block type
 * contributes (see `blockSettingsRegistry`).
 *
 * Always mounted (when enabled) so the very first open slides in like every one
 * after it — mounting straight into the open state would skip the transition.
 */
export function BlockPanel({
	block,
	onClose,
	children,
	defaultWidth,
	minWidth,
	maxWidth,
	storageKey,
}: BlockPanelProps) {
	// The last block is kept on screen while the panel slides out.
	const shown = useRef<BlockNode | null>(null);
	if (block) shown.current = block;
	const current = block ?? shown.current;

	const type = current?.type ?? "unknown";
	const { name, description, definition, custom } = blockLabels(type, current?.data);
	// A custom block: the label titles the panel and the identifier sits under it,
	// since that is what flows and `param:` references are written against.
	const customDef = useCustomBlockDefs().find((def) => def.name === type);
	const title = custom ? name : (customDef?.label ?? name);
	const subtitle = customDef ? customDef.name : description;
	const tabs = blockSettingsTabs(current?.type);

	const {
		width,
		isResizing,
		handleMouseDown,
		handleTouchStart,
		handleDoubleClick,
		handleKeyDown,
		minWidth: resolvedMinWidth,
		maxWidth: resolvedMaxWidth,
	} = useBlockPanelResize({ defaultWidth, minWidth, maxWidth, storageKey, onClose });

	return (
		<aside
			className={`fx-panel${block ? " fx-panel--open" : ""}${isResizing ? " fx-panel--resizing" : ""}`}
			style={{
				width: block ? `${width}px` : 0,
			}}
			aria-label={current ? `${name} settings` : "Block settings"}
			aria-hidden={!block}
			data-block-id={current?.id}
			data-block-type={current ? type : undefined}
		>
			{block && (
				<div
					className="fx-panel__resize-handle"
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-label="Resize block settings panel"
					aria-valuenow={Math.round(width)}
					aria-valuemin={Number.isFinite(resolvedMinWidth) ? resolvedMinWidth : 0}
					aria-valuemax={Number.isFinite(resolvedMaxWidth) ? resolvedMaxWidth : 9999}
					onMouseDown={handleMouseDown}
					onTouchStart={handleTouchStart}
					onDoubleClick={handleDoubleClick}
					onKeyDown={handleKeyDown}
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
			)}
			{current && (
				<>
					<header className="fx-panel__header">
						<span
							className="fx-panel__icon"
							style={definition.tint ? { color: definition.tint } : undefined}
						>
							{customDef ? (
								<CustomBlockIcon icon={customDef.icon} iconUrl={customDef.iconUrl} />
							) : (
								blockIcon(type)
							)}
						</span>
						<span className="fx-panel__titles">
							{/* Renaming lives in the General tab; the header only shows it. */}
							<span className="fx-panel__name" title={title}>
								{title}
							</span>
							{/* What the block does — or, for a custom block, what it is called. */}
							<span
								className="fx-panel__type"
								title={customDef ? `Block type: ${subtitle}` : subtitle}
							>
								{subtitle}
							</span>
						</span>
						{current.id && (
							<span className="fx-panel__block-id" title={`Block ID: ${current.id}`}>
								{current.id.split("-")[0]}
							</span>
						)}
						<button
							type="button"
							className="fx-panel__close"
							title="Collapse panel"
							aria-label="Collapse panel"
							onClick={onClose}
						>
							<TbChevronsRight />
						</button>
					</header>

					<div className="fx-panel__body">
						<BlockSettings block={current}>{tabs?.(current)}</BlockSettings>
						{children}
					</div>
				</>
			)}
		</aside>
	);
}


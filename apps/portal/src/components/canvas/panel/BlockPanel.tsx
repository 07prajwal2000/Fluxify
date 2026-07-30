import { useRef } from "react";
import { TbChevronsRight } from "react-icons/tb";
import "./panel.css";
import {
	BlockDescriptionField,
	BlockNameInput,
} from "./BlockIdentityFields";
import { blockIcon } from "../blocks/blockIconMap";
import { blockLabels } from "../blocks/blockLabels";
import type { BlockNode } from "../types";

export type BlockPanelProps = {
	/** Block to show, or `null` to slide the panel out. */
	block: BlockNode | null;
	onClose: () => void;
	/** Rendered under the fields — where the settings form will go. */
	children?: React.ReactNode;
};

/**
 * Side panel for the block that was opened: what it is, what it is called, what it
 * does. The settings form and the AI prompt are the next layers and slot in as
 * `children`, so this shell stays presentational.
 *
 * Always mounted (when enabled) so the very first open slides in like every one
 * after it — mounting straight into the open state would skip the transition.
 */
export function BlockPanel({ block, onClose, children }: BlockPanelProps) {
	// The last block is kept on screen while the panel slides out.
	const shown = useRef<BlockNode | null>(null);
	if (block) shown.current = block;
	const current = block ?? shown.current;

	const type = current?.type ?? "unknown";
	const { name, definition } = blockLabels(type, current?.data);

	return (
		<aside
			className={`fx-panel${block ? " fx-panel--open" : ""}`}
			aria-label={current ? `${name} settings` : "Block settings"}
			aria-hidden={!block}
			data-block-id={current?.id}
			data-block-type={current ? type : undefined}
		>
			{current && (
				<>
					<header className="fx-panel__header">
						<span
							className="fx-panel__icon"
							style={definition.tint ? { color: definition.tint } : undefined}
						>
							{blockIcon(type)}
						</span>
						<span className="fx-panel__titles">
							{/* Renaming happens where the name is shown. */}
							<BlockNameInput
								key={current.id}
								blockId={current.id}
								data={current.data}
								placeholder="Name"
							/>
							{/* What the block actually is, under whatever it was named. */}
							<span className="fx-panel__type" title={type}>
								{definition.name}
							</span>
						</span>
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
						<section className="fx-panel__section">
							{/* Remount per block so the inputs never carry a stale draft. */}
							<BlockDescriptionField
								key={current.id}
								blockId={current.id}
								data={current.data}
								placeholder={definition.description}
							/>
						</section>
						{children}
					</div>
				</>
			)}
		</aside>
	);
}

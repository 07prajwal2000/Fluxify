import type { ComponentProps, ReactNode } from "react";
import { BlockPickerSidebar } from "./BlockPickerSidebar";
import type { useCanvasDiagnosticsBridge } from "./diagnostics";
import { DiagnosticsPanel } from "./diagnostics";
import { PlaygroundModal } from "./PlaygroundModal";
import type { useBlockPanel } from "./panel";
import { BlockPanel } from "./panel";
import { canInsertIntoEdge } from "./quickAdd";
import type { BlockNode } from "./types";
import type { useAddBlock } from "./useAddBlock";
import type { useBlockPicker } from "./useBlockPicker";

export interface CanvasOverlaysProps {
	readOnly: boolean;
	layoutLocked: boolean;
	enableBlockPicker: boolean;
	blockPicker: ReturnType<typeof useBlockPicker>;
	addPickedBlock: ComponentProps<typeof BlockPickerSidebar>["onAdd"];
	pending: ReturnType<typeof useAddBlock>["pending"];
	panel: ReturnType<typeof useBlockPanel>;
	openBlock: BlockNode | null;
	diagnostics: ReturnType<typeof useCanvasDiagnosticsBridge>["diagnostics"];
	handleSelectBlock: (blockId: string) => void;
	enablePlayground: boolean;
	playgroundContent?: ReactNode;
	trackExecutionContent?: ReactNode;
}

/**
 * Secondary overlays and sidebars anchored around the canvas:
 * block picker sidebar, block settings panel, diagnostics drawer,
 * and the playground modal dialog.
 */
export function CanvasOverlays({
	readOnly,
	layoutLocked,
	enableBlockPicker,
	blockPicker,
	addPickedBlock,
	pending,
	panel,
	openBlock,
	diagnostics,
	handleSelectBlock,
	enablePlayground,
	playgroundContent,
	trackExecutionContent,
}: CanvasOverlaysProps) {
	return (
		<>
			{!readOnly && !layoutLocked && enableBlockPicker && (
				<BlockPickerSidebar
					isOpen={blockPicker.isOpen}
					onOpenChange={blockPicker.onOpenChange}
					onAdd={addPickedBlock}
					filter={pending?.kind === "edge" ? canInsertIntoEdge : undefined}
					filterReason="Needs an input and an output to sit inside a connection."
				/>
			)}
			{panel.enabled && (
				<BlockPanel
					block={openBlock}
					initialTab={panel.initialTab}
					openSeq={panel.openSeq}
					onClose={panel.close}
				/>
			)}
			<DiagnosticsPanel
				isOpen={diagnostics.isPanelOpen}
				onClose={diagnostics.closePanel}
				onSelectBlock={handleSelectBlock}
			/>
			{enablePlayground && playgroundContent && (
				<PlaygroundModal trackExecution={trackExecutionContent}>
					{playgroundContent}
				</PlaygroundModal>
			)}
		</>
	);
}

import { useEffect, useState } from "react";
import { Button, Modal, CloseButton } from "@fluxify/components";
import { TbEye } from "react-icons/tb";
import { BlockCanvas } from "@/components/canvas/BlockCanvas";
import { createBlockNodeTypes } from "@/components/canvas/blocks";
import type { CanvasGraph } from "@/components/canvas/types";

const nodeTypes = createBlockNodeTypes();

/** Readonly canvas. The settings panel stays on — it only reads — so a reviewer
 *  can open a block and see how the agent configured it. */
function ReadonlyCanvas({ graph, className }: { graph: CanvasGraph; className?: string }) {
	return (
		<BlockCanvas
			graph={graph}
			mode="readonly"
			nodeTypes={nodeTypes}
			enableHistory={false}
			enableFormat={false}
			enableClipboard={false}
			className={className}
		/>
	);
}

/**
 * Thumbnail of the proposed graph with a hover "Preview" affordance; the modal
 * is where it is actually readable.
 */
export function CanvasPreview({ graph, title }: { graph: CanvasGraph; title: string }) {
	const [open, setOpen] = useState(false);
	// React Flow measures its container once on mount and `fitView` runs against
	// that measurement. Mounting it while the dialog is still being laid out
	// fits the graph into a 0×0 box, which reads as an empty canvas — so wait a
	// frame after opening, when the dialog has its real size.
	const [sized, setSized] = useState(false);
	useEffect(() => {
		if (!open) return setSized(false);
		const frame = requestAnimationFrame(() => setSized(true));
		return () => cancelAnimationFrame(frame);
	}, [open]);

	return (
		<>
			<div className="group relative h-52 rounded-lg border border-border overflow-hidden">
				{/* the thumbnail is decoration; every interaction goes through the modal */}
				<div className="h-full pointer-events-none">
					<ReadonlyCanvas graph={graph} />
				</div>
				<div className="absolute inset-0 flex items-center justify-center bg-overlay/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity">
					<Button
						size="sm"
						variant="primary"
						className="flex items-center gap-2 cursor-pointer"
						onPress={() => setOpen(true)}
					>
						<TbEye size={16} /> Preview
					</Button>
				</div>
			</div>

			<Modal isOpen={open} onOpenChange={setOpen}>
				<Modal.Backdrop>
					{/* The container is `width: fit-content`, so a dialog whose content
					    sizes itself off the dialog (a canvas at 100%) collapses to 0.
					    Inline width beats the slot class and breaks the loop. */}
					<Modal.Container
							placement="center"
							size="cover"
							className="fx-canvas-modal"
						>
						<Modal.Dialog className="min-h-0">
							<Modal.Header className="border-b border-border px-6 py-3 flex flex-row items-center justify-between">
								<h3 className="text-lg font-semibold">{title}</h3>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="p-0 overflow-hidden flex-1 min-h-0">
								{sized && <ReadonlyCanvas graph={graph} />}
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}

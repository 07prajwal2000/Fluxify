import { useMemo } from "react";
import { BlockCanvas } from "@/components/canvas/BlockCanvas";
import { createBlockNodeTypes } from "@/components/canvas/blocks";
import { toGraph } from "@/components/canvas/CanvasWorkbench";
import { CanvasDiagnosticsProvider } from "@/components/canvas/diagnostics";
import type { CanvasItems } from "@/services/canvas";

const nodeTypes = createBlockNodeTypes();

/** a version's blocks and edges as the canvas loads them */
export const versionItems = (snapshot: { blocks: unknown[]; edges: unknown[] }): CanvasItems => ({
	canvasRevision: 0,
	blocks: snapshot.blocks as CanvasItems["blocks"],
	edges: snapshot.edges as CanvasItems["edges"],
});

/**
 * A version's canvas, to look at and nothing more (#738). Blocks can be
 * selected so their settings can be read, but not changed; there is no Save and
 * no undo. The parent keys it by version, so each one starts from its own view.
 */
export function VersionCanvas({ snapshot }: { snapshot: { blocks: unknown[]; edges: unknown[] } }) {
	const graph = useMemo(() => toGraph(versionItems(snapshot)), [snapshot]);
	return (
		// its own diagnostics: the editor canvas elsewhere must not pick up these blocks
		<CanvasDiagnosticsProvider>
			<BlockCanvas
				graph={graph}
				mode="readonly"
				nodeTypes={nodeTypes}
				enableHistory={false}
				enableFormat={false}
				enableClipboard={false}
			/>
		</CanvasDiagnosticsProvider>
	);
}

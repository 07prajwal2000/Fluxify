import { lazy, Suspense, useMemo, useState } from "react";
import type { ToolPart } from "../agentMessages";
import { canvasFromRead } from "./canvasRead";

// ReactFlow is only loaded once a canvas is on screen
const CanvasDiffGraph = lazy(() => import("./CanvasDiffGraph"));

/** True when get_canvas's answer can be drawn as the canvas. */
export const canDraw = (tool: ToolPart) => canvasFromRead(tool) !== null;

/** get_canvas: the canvas as it is, read-only, with the block settings panel on a double click. */
export function GetCanvasPreview({ tool }: { tool: ToolPart }) {
	const diff = useMemo(() => canvasFromRead(tool), [tool]);
	const [picked, setPicked] = useState<string>();
	if (!diff) return null;
	return (
		<div className="flex flex-col gap-1">
			<Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface-secondary" />}>
				<CanvasDiffGraph diff={diff} selected={picked} onSelect={setPicked} panel />
			</Suspense>
			<p className="text-xs text-muted">Double-click a block for its settings.</p>
		</div>
	);
}

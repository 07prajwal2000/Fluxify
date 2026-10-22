import { Panel } from "@xyflow/react";
import type { ReactNode } from "react";

/** Status badges in the canvas's top-left corner; render inside React Flow (`canvasOverlay`). */
export function CanvasStatusBadges({ children }: { children: ReactNode }) {
	return (
		<Panel position="top-left" className="flex items-center gap-2">
			{children}
		</Panel>
	);
}

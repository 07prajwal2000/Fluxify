import { lazy, Suspense, useMemo, useState } from "react";
import type { RouteBundle } from "@/services/routes";
import { previewCanvas } from "./routeImport";

// ReactFlow is only loaded once the confirmation is on screen
const CanvasDiffGraph = lazy(() => import("@/components/ai/preview/CanvasDiffGraph"));

// tall enough to read a route; the dialog puts it beside the form
const HEIGHT = "h-[32rem]";

/**
 * The route's blocks on a read-only canvas, so the user sees what an import would bring in.
 * Clicking a block opens its settings, read-only too: a canvas in read-only mode locks the panel.
 */
export function RouteBundlePreview({ bundle }: { bundle: RouteBundle }) {
	const diff = useMemo(() => previewCanvas(bundle), [bundle]);
	const [picked, setPicked] = useState<string>();
	return (
		<Suspense
			fallback={<div className={`${HEIGHT} animate-pulse rounded-lg bg-surface-secondary`} />}
		>
			<CanvasDiffGraph
				diff={diff}
				selected={picked}
				onSelect={setPicked}
				panel
				heightClass={HEIGHT}
			/>
		</Suspense>
	);
}

import { lazy, Suspense, useMemo } from "react";
import type { RouteBundle } from "@/services/routes";
import { previewCanvas } from "./routeImport";

// ReactFlow is only loaded once the confirmation is on screen
const CanvasDiffGraph = lazy(() => import("@/components/ai/preview/CanvasDiffGraph"));

/** The route's blocks on a read-only canvas, so the user sees what an import would bring in. */
export function RouteBundlePreview({ bundle }: { bundle: RouteBundle }) {
	const diff = useMemo(() => previewCanvas(bundle), [bundle]);
	return (
		<Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface-secondary" />}>
			<CanvasDiffGraph diff={diff} onSelect={() => {}} />
		</Suspense>
	);
}

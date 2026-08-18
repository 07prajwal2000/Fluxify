import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { routesQuery } from "@/query/routesQuery";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { SubArtifactDetail } from "@/services/harnessConversations";
import { previewGraph, type BlockBuilderPayload } from "./previewGraph";

export function useArtifactParams() {
	return useParams({ from: "/_authed/$projectId/ai/$conversationId" });
}

/** Every output of the same run, with payloads. Small runs only — that is what a
 *  run is — and the two links we need (canvas → route) live in the payloads. */
export function useRunSiblings(runId: string | undefined, kind?: string) {
	const { projectId, conversationId } = useArtifactParams();
	const { data } = harnessConversationsQuery.subArtifacts.useQuery(
		projectId,
		conversationId,
		runId ?? "",
	);
	const ids = useMemo(
		() =>
			(data?.subArtifacts ?? [])
				.filter((s) => !kind || s.kind === kind)
				.map((s) => s.id),
		[data, kind],
	);
	const results = harnessConversationsQuery.subArtifacts.useDetailsQuery(
		projectId,
		conversationId,
		ids,
	);
	return results
		.map((r) => r.data)
		.filter((d): d is SubArtifactDetail => Boolean(d));
}

const EMPTY_CANVAS = { blocks: [], edges: [] };

/**
 * A canvas output resolved against the workspace: the graph it would produce,
 * and whether its route is live yet. A canvas whose route this run created can
 * only be applied after that route output is — the server rejects it otherwise,
 * so the UI points at the route instead of offering a button that 409s.
 */
export function useCanvasArtifact(detail: SubArtifactDetail | undefined) {
	const payload = (detail?.payload ?? {}) as BlockBuilderPayload;
	const targetId = payload.targetType === "custom_block" ? "" : (payload.targetId ?? "");

	// The route output of this same run, if the run created the route.
	const routeSiblings = useRunSiblings(detail?.runId, "route");
	const sibling =
		routeSiblings.find((s) => s.payload?.routeId === targetId) ??
		// ponytail: a canvas applied before the id-rewrite fix still names the id
		// the agent invented, so it matches nothing. One route in the run is the
		// only case worth healing; drop this once those rows have aged out.
		(routeSiblings.length === 1 ? routeSiblings[0] : undefined);

	// what the route is actually called in storage, once it has been created
	const routeId = (sibling?.payload?.routeId as string) ?? targetId;
	const route = routesQuery.byId.useQuery(routeId);

	// A just-applied sibling counts even before its route resolves here — the
	// apply already happened, so gating on the fetch would flap.
	const routeExists = Boolean(route.data) || Boolean(sibling?.appliedAt);
	const blockingRoute = sibling && !sibling.appliedAt ? sibling : undefined;

	// merging against the live graph is only meaningful once the route is there
	const canvasItems = routesQuery.canvasItems.useQuery(route.data ? routeId : "");

	const existing = canvasItems.data ?? EMPTY_CANVAS;
	const graph = useMemo(
		() => previewGraph(payload, existing),
		// payload identity is stable while the query cache holds it
		[payload, existing],
	);

	return {
		graph,
		route: route.data,
		routeId,
		routeExists,
		blockingRoute,
		isLoading: route.isLoading || canvasItems.isLoading,
	};
}

/** Custom-block canvases have the same graph payload as route canvases, but
 * live behind the custom-block API rather than the route API. */
export function useCustomBlockCanvasArtifact(detail: SubArtifactDetail | undefined) {
	const payload = (detail?.payload ?? {}) as BlockBuilderPayload;
	const targetId = payload.targetId ?? "";
	const existingCanvas = customBlocksQuery.canvasItems.useQuery(targetId);
	const graph = useMemo(
		() => previewGraph(payload, existingCanvas.data ?? EMPTY_CANVAS),
		[payload, existingCanvas.data],
	);
	return { graph, isLoading: existingCanvas.isLoading };
}

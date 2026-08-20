import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import {
	kindLabel,
	parentsOf,
} from "@fluxify/ai-gateway/src/api/v1/harness-conversations/artifacts/dependencies";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { routesQuery } from "@/query/routesQuery";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { SubArtifactDetail } from "@/services/harnessConversations";
import { previewGraph, type BlockBuilderPayload } from "./previewGraph";

export { kindLabel };

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

/** What the sidebar switches on. One map, so opening an output from a
 *  dependency chain lands on the same panel the chat chip would. */
const SIDEBAR_TYPE: Record<string, string> = {
	route: "Route changes",
	canvas: "Canvas Changes",
	custom_block: "Custom Block changes",
};

export const artifactTypeForKind = (kind: string) => SIDEBAR_TYPE[kind] ?? kind;

/**
 * The output that has to be applied before this one can be, if there is one.
 *
 * The server refuses a child whose parent is still a proposal, so the UI asks
 * the same question rather than offering a button that 409s. Both use the same
 * `parentsOf`, so they cannot drift.
 */
export function useBlockingParent(detail: SubArtifactDetail | undefined) {
	const siblings = useRunSiblings(detail?.runId);
	return useMemo(
		() =>
			detail
				? parentsOf(detail, siblings).find((parent) => !parent.appliedAt)
				: undefined,
		[detail, siblings],
	);
}

/**
 * Everything this output hangs off, furthest ancestor first — the order the
 * user has to apply them in. Rendered as a trail so a blocked output shows what
 * it is waiting on rather than just refusing.
 */
export function useDependencyChain(detail: SubArtifactDetail | undefined) {
	const siblings = useRunSiblings(detail?.runId);
	return useMemo(() => {
		const chain: SubArtifactDetail[] = [];
		const seen = new Set<string>();
		let current = detail;
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			// One parent is enough for a trail; a genuine fan-in is not something a
			// run produces, and a list of them reads worse than the nearest one.
			current = parentsOf(current, siblings).find((p) => !seen.has(p.id));
			if (current) chain.unshift(current);
		}
		return chain;
	}, [detail, siblings]);
}

const EMPTY_CANVAS = { blocks: [], edges: [] };

/**
 * A canvas output resolved against the workspace: the graph it would produce,
 * and whether its route is live yet.
 *
 * `routeExists` answers only "is there a route to hang this off" — a route from
 * an earlier run that has since been deleted. Whether a *sibling* output has to
 * be applied first is {@link useBlockingParent}'s job, for every kind at once.
 */
export function useCanvasArtifact(detail: SubArtifactDetail | undefined) {
	const payload = (detail?.payload ?? {}) as BlockBuilderPayload;
	const targetsRoute = payload.targetType !== "custom_block";
	const targetId = targetsRoute ? (payload.targetId ?? "") : "";

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
		targetsRoute,
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

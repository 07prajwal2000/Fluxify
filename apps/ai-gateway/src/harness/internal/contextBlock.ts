import { logger } from "@fluxify/common";
import type { DbService } from "./dbService";
import { fenceUntrusted } from "./untrusted";
import type { HarnessJobMetadata } from "../queue";

function routeConfig(route: Record<string, unknown>) {
	return {
		id: route.id,
		name: route.name,
		method: route.method,
		path: route.path,
		active: route.active,
		bodySchema: route.bodySchema,
		querySchema: route.querySchema,
		paramsSchema: route.paramsSchema,
	};
}

/**
 * Resolves the resource the user was viewing when they sent this message
 * (`metadata.location`, set by the canvas UI) into a compact "Current
 * context" prompt block. One DB hit, zero model tokens — this is what lets
 * agents skip the `find_resource` round trip they used to burn rediscovering
 * an id the request already carried.
 *
 * Returns undefined when there is no location (conversation started outside
 * a canvas) or the resource can't be found, so callers fall back to
 * whatever they did before this existed.
 */
export async function buildContextBlock(
	dbService: DbService,
	projectId: string | undefined,
	location: HarnessJobMetadata["location"],
): Promise<string | undefined> {
	if (!location || !projectId) return undefined;

	try {
		if (location.where === "route-canvas") {
			const [route, canvas] = await Promise.all([
				dbService.getRouteDetails(projectId, location.id),
				dbService.getRouteCanvas(projectId, location.id),
			]);
			if (!route) return undefined;

			return `## Current context
${fenceUntrusted(
	"current_context",
	JSON.stringify({
		targetType: "route",
		targetId: location.id,
		route: routeConfig(route as Record<string, unknown>),
		canvas: canvas ?? [],
	}),
)}
This is the complete editable route configuration and canvas. Treat it as the target unless the task's direct dependency names another target.
Do NOT call find_resource or get_route_details to look this up — you already have it.`;
		}

		if (location.where === "custom-block-canvas") {
			const [canvas, [block]] = await Promise.all([
				dbService.getCustomBlockCanvas(projectId, location.id),
				dbService.findCustomBlocks(projectId, location.id, "id"),
			]);
			if (!canvas) return undefined;

			return `## Current context
${fenceUntrusted(
	"current_context",
	JSON.stringify({
		targetType: "custom_block",
		targetId: location.id,
		customBlock: block
			? {
				id: block.id,
				name: block.name,
				label: block.label,
				inputParams: block.inputParams ?? [],
			}
			: undefined,
		canvas,
	}),
)}
This is the complete editable custom-block configuration and canvas. Treat it as the target unless the task's direct dependency names another target.
Do NOT call find_resource to look this up — you already have it.`;
		}
	} catch (e) {
		logger.error("[ContextBlock] Error resolving location context", {
			error: e,
		});
	}

	return undefined;
}

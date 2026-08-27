import { logger } from "@fluxify/common";
import type { DbService } from "./dbService";
import { extractResourceChips, fenceUntrusted } from "./untrusted";
import { renderCanvas } from "./renderCanvas";
import type { HarnessJobMetadata } from "../queue";

type Location = HarnessJobMetadata["location"];

const CANVAS_OF: Record<string, NonNullable<Location>["where"]> = {
	route: "route-canvas",
	custom_block: "custom-block-canvas",
};

/**
 * A resource the user @-mentioned names the target as deterministically as the
 * canvas they had open, and the composer already put its type and id in the
 * message — so an agent should never have to look one up.
 *
 * Only a fallback for when there is no open canvas: a mention while one is open
 * may be a reference rather than the target, and demoting `location` there
 * would change what every agent treats as current. Only one mention counts —
 * two is a genuine choice, and the agents have tools to make it.
 */
export function locationFromResourceChips(
	query: string | undefined,
	location: Location,
): Location {
	if (location || !query) return location;
	const targets = extractResourceChips(query).flatMap((chip) => {
		const where = CANVAS_OF[chip.type];
		return where ? [{ where, id: chip.id }] : [];
	});
	return targets.length === 1 ? targets[0] : undefined;
}

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
	as: "current" | "target" = "current",
): Promise<string | undefined> {
	if (!location || !projectId) return undefined;

	// The resource the user happened to be viewing is a default the task can
	// override; a resolved target is not — hedging there is what sends the agent
	// looking for a better candidate it does not need.
	const heading = as === "target" ? "## Target canvas" : "## Current context";
	const claim =
		as === "target"
			? "This is the resource this task edits."
			: "Treat it as the target unless the task's direct dependency names another target.";

	try {
		if (location.where === "route-canvas") {
			const [route, canvas] = await Promise.all([
				dbService.getRouteDetails(projectId, location.id),
				dbService.getRouteCanvas(projectId, location.id),
			]);
			if (!route) return undefined;

			// targetType/targetId sit outside the fence: the harness resolved them,
			// they are not project data, and an agent must be able to trust them.
			return `${heading}
targetType: route
targetId: ${location.id}
${fenceUntrusted(
	"current_context",
	`route: ${JSON.stringify(routeConfig(route as Record<string, unknown>))}

${renderCanvas(canvas)}`,
)}
This is the complete editable route configuration and canvas. ${claim}
Do NOT call find_resource or get_route_details to look this up — you already have it.`;
		}

		if (location.where === "custom-block-canvas") {
			const [canvas, [block]] = await Promise.all([
				dbService.getCustomBlockCanvas(projectId, location.id),
				dbService.findCustomBlocks(projectId, location.id, "id"),
			]);
			if (!canvas) return undefined;

			return `${heading}
targetType: custom_block
targetId: ${location.id}
${fenceUntrusted(
	"current_context",
	`${
		block
			? `customBlock: ${JSON.stringify({
					id: block.id,
					name: block.name,
					label: block.label,
					inputParams: block.inputParams ?? [],
				})}\n\n`
			: ""
	}${renderCanvas(canvas)}`,
)}
This is the complete editable custom-block configuration and canvas. ${claim}
Do NOT call find_resource to look this up — you already have it.`;
		}
	} catch (e) {
		logger.error("[ContextBlock] Error resolving location context", {
			error: e,
		});
	}

	return undefined;
}

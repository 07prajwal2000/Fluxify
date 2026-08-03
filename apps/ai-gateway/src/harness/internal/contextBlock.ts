import { logger } from "@fluxify/common";
import type { DbService } from "./dbService";
import { fenceUntrusted } from "./untrusted";
import type { HarnessJobMetadata } from "../queue";

/** One line per block: id, type, and outgoing connections only — never the
 *  block's full `data` payload, which would be a large blob and defeat the
 *  point of resolving this for free. */
function summarizeCanvas(canvas: Array<Record<string, any>>): string {
	if (canvas.length === 0) return "0 blocks (empty canvas)";
	const lines = canvas.map((b) => {
		const targets = (b.connections ?? [])
			.map((c: any) => c.blockId)
			.filter(Boolean);
		return `${b.id}(${b.blockType})${targets.length ? `->${targets.join(",")}` : ""}`;
	});
	return `${canvas.length} blocks: ${lines.join(", ")}`;
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
	`The user is currently viewing route \`${location.id}\` (${route.method} ${route.path}, "${route.name}").
Its canvas has ${summarizeCanvas(canvas ?? [])}.`,
)}
Treat this as the target unless the request names another resource.
Do NOT call find_resource to look this up — you already have it.`;
		}

		if (location.where === "custom-block-canvas") {
			const canvas = await dbService.getCustomBlockCanvas(
				projectId,
				location.id,
			);
			if (!canvas) return undefined;

			return `## Current context
${fenceUntrusted(
	"current_context",
	`The user is currently viewing custom block \`${location.id}\`.
Its canvas has ${summarizeCanvas(canvas)}.`,
)}
Treat this as the target unless the request names another resource.
Do NOT call find_resource to look this up — you already have it.`;
		}
	} catch (e) {
		logger.error("[ContextBlock] Error resolving location context", {
			error: e,
		});
	}

	return undefined;
}

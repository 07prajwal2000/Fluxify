import type { CanvasDiff } from "@/components/ai/preview/canvasDiff";
import type { RouteBundle, RouteImportConflicts } from "@/services/routes";

/** `Get users` → `Get users-copy` */
export const copyName = (name: string) => `${name}-copy`;

/**
 * A path the copy can take next to the original: `/users` → `/users-copy`. A
 * path that ends in a param (or a slash) gets a segment instead, because
 * `:id-copy` would read as one oddly named param.
 */
export function copyPath(path: string): string {
	const base = path.replace(/\/+$/, "");
	if (base === "" || base.split("/").pop()?.startsWith(":")) return `${base}/copy`;
	return `${base}-copy`;
}

/**
 * What the confirmation starts with. What is already taken in the project gets
 * a "-copy" (the name, the path, or both); what is free stays as exported. The
 * user can change either.
 */
export function importDefaults(route: RouteBundle["route"], conflicts: RouteImportConflicts) {
	return {
		name: conflicts.nameTaken ? copyName(route.name) : route.name,
		path: conflicts.pathTaken ? copyPath(route.path) : route.path,
	};
}

/** The warning under the fields: what already exists, and that it was renamed as a copy. */
export function conflictNotice(
	route: RouteBundle["route"],
	{ nameTaken, pathTaken }: RouteImportConflicts,
): string | undefined {
	const taken = [
		nameTaken && `a route named "${route.name}"`,
		pathTaken && `${route.method} ${route.path}`,
	].filter(Boolean);
	if (taken.length === 0) return undefined;
	return `${taken.join(" and ")} already exist${taken.length === 1 ? "s" : ""} in this project. It will be imported as a copy, or rename it as you like.`;
}

/** The bundle's canvas as the read-only canvas draws it: every block as it is. */
export function previewCanvas(bundle: RouteBundle): CanvasDiff {
	return {
		blocks: bundle.canvas.blocks.map((b) => ({
			key: b.id,
			type: b.type,
			status: "same",
			position: b.position,
			data: (b.data ?? {}) as Record<string, unknown>,
			changes: [],
		})),
		edges: bundle.canvas.edges.map((e) => ({
			id: e.id,
			from: e.from,
			to: e.to,
			// handle ids are `<block>-<handle>`; the canvas wants the handle's own name
			handle: e.fromHandle?.startsWith(`${e.from}-`)
				? e.fromHandle.slice(e.from.length + 1)
				: "source",
			status: "same",
		})),
	};
}

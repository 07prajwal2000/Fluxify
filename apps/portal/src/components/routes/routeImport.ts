import type { CanvasDiff } from "@/components/ai/preview/canvasDiff";
import type { RouteBundle } from "@/services/routes";

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
 * What the confirmation starts with. Into the project it came from, the route
 * would collide with its original, so the copy gets a "-copy" name and path;
 * into another project it keeps both. Either way the user can change them.
 */
export function importDefaults(bundle: RouteBundle, projectId: string) {
	const { name, path } = bundle.route;
	return bundle.sourceProjectId === projectId
		? { name: copyName(name), path: copyPath(path) }
		: { name, path };
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

import { blockToNode, flowToGraph } from "@/components/canvas/adapters";
import { TRANSFER_KIND, TRANSFER_VERSION } from "@/components/canvas/transfer/format";
import { prepareImport } from "@/components/canvas/transfer/prepareImport";
import type { BlockData } from "@/components/canvas/types";
import type { CanvasItems } from "@/services/canvas";
import { routesService } from "@/services/routes";
import { sandboxesService } from "@/services/sandboxes";
import { workflowsService } from "@/services/workflows";

/** the server's blocks as the canvas holds them: data is always an object */
const asBlocks = (blocks: CanvasItems["blocks"]) =>
	blocks.map((block) => ({ ...block, data: (block.data ?? {}) as BlockData }));

export type SandboxSource = { kind: "route" | "workflow"; id: string; name: string };

/** What a copy to a sandbox leaves behind, for the confirm dialog (the same list copy_blocks answers with). */
export function copyWarnings(route: { hasMiddlewares: boolean; hasSchemas: boolean }) {
	const warnings: string[] = [];
	if (route.hasMiddlewares)
		warnings.push("The route's middlewares are not copied. They are route settings, not blocks.");
	if (route.hasSchemas)
		warnings.push(
			"The request schemas (body, query, params) are not copied. A sandbox accepts any body.",
		);
	return warnings;
}

/**
 * Makes the sandbox "<name> sandbox" and saves the whole canvas into it, entry
 * block wired to the sandbox's own entrypoint. A failed save removes the sandbox
 * again, so there is never a half-copied one. Resolves to the sandbox id.
 */
export async function openInSandbox(projectId: string, source: SandboxSource) {
	const { id } = await sandboxesService.create(projectId, { name: `${source.name} sandbox` });
	try {
		const from = await (source.kind === "route" ? routesService : workflowsService).getCanvasItems(
			source.id,
		);
		const own = await sandboxesService.getCanvasItems(projectId, id);
		// the entrypoint and error handler are the sandbox's own; the rest is cloned with new ids
		const { part } = prepareImport(
			{
				kind: TRANSFER_KIND,
				version: TRANSFER_VERSION,
				exportedAt: new Date().toISOString(),
				blocks: asBlocks(from.blocks),
				edges: from.edges,
			},
			asBlocks(own.blocks).map(blockToNode),
		);
		const copy = flowToGraph(part.nodes, part.edges);
		await sandboxesService.saveCanvas(projectId, id, {
			actionsToPerform: {
				blocks: copy.blocks.map((b) => ({ id: b.id, action: "upsert" as const })),
				edges: copy.edges.map((e) => ({ id: e.id, action: "upsert" as const })),
			},
			changes: copy,
		});
		return id;
	} catch (error) {
		await sandboxesService.delete(projectId, id).catch(() => undefined);
		throw error;
	}
}

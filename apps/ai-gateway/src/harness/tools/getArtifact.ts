import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../types";
import type { DbService } from "../internal/dbService";

// ponytail: flat char cap so one fat canvas payload can't blow the context
// window. If this starts truncating things users need, page per sub-artifact.
const MAX_CHARS = 12000;

/**
 * An applied artifact IS a real project record, so the stored payload is a
 * stale copy of it — the agent then had to call `find_resource` to get the
 * real ids and current state, one round trip per artifact, and often planned
 * against the copy instead. Read the live record here and hand it back whole.
 * Returns null when the resource has since been deleted.
 */
async function resolveLive(
	dbService: DbService,
	projectId: string | undefined,
	row: { kind: string; payload: any },
): Promise<Record<string, unknown> | null> {
	if (!projectId) return null;
	const p = (row.payload ?? {}) as Record<string, any>;
	try {
		switch (row.kind) {
			case "route": {
				const route = await dbService.getRouteDetails(projectId, p.routeId);
				if (!route) return null;
				return {
					route,
					canvas: await dbService.getRouteCanvas(projectId, p.routeId),
				};
			}
			case "custom_block": {
				const [block] = await dbService.findCustomBlocks(
					projectId,
					p.customBlockId,
					"id",
				);
				if (!block) return null;
				return {
					customBlock: block,
					canvas: await dbService.getCustomBlockCanvas(projectId, block.id),
				};
			}
			case "canvas": {
				const canvas =
					p.targetType === "custom_block"
						? await dbService.getCustomBlockCanvas(projectId, p.targetId)
						: await dbService.getRouteCanvas(projectId, p.targetId);
				return canvas
					? { targetType: p.targetType, targetId: p.targetId, canvas }
					: null;
			}
			default:
				return null;
		}
	} catch {
		return null;
	}
}

/**
 * Reads back what previous runs actually built. The summary markdown of a past
 * run embeds sub-artifact ids in its tokens (`:route{... sub_artifact_id="..."}`,
 * `:canvasChanges{... artifact_id="..."}`), so the discussion agent can pull the
 * exact stored output instead of guessing from the summary prose.
 */
export const createGetArtifactTool = (
	dbService: DbService,
	metadata: WorkflowMetadata,
) => {
	return fencedTool(
		async ({ artifactIds }) => {
			logger.info(
				`[Tools] Fetching artifacts ${artifactIds.join(", ")} for conversation ${metadata.conversationId}`,
			);

			const rows = await dbService.getSubArtifacts(
				metadata.conversationId,
				artifactIds,
			);
			if (rows.length === 0) {
				return "No artifacts found for those ids in this conversation.";
			}

			const parts = await Promise.all(
				rows.map(async (r) => {
					const head = `## artifact ${r.id} (kind=${r.kind}, action=${r.action ?? "n/a"}, applied=${r.appliedAt ? `yes, at ${new Date(r.appliedAt).toISOString()}` : "no"}, run=${r.runId}, created=${new Date(r.createdAt).toISOString()})`;
					if (!r.appliedAt) {
						return `${head}\nNOT APPLIED — this was only proposed. It does not exist in the project, has no real id, and nothing can reference it yet.\nProposed output: ${JSON.stringify(r.payload)}`;
					}
					const live = await resolveLive(dbService, metadata.projectId, r);
					return live
						? `${head}\nAPPLIED — live in the project. Current state read from the database (use these ids; do not look it up again):\n${JSON.stringify(live)}`
						: `${head}\nAPPLIED, but the resource it created is gone from the project (deleted since).\nWhat was applied: ${JSON.stringify(r.payload)}`;
				}),
			);
			const body = parts.join("\n\n");

			return body.length > MAX_CHARS
				? `${body.slice(0, MAX_CHARS)}\n\n[truncated — ${body.length - MAX_CHARS} more characters. Re-run with fewer ids to see the rest.]`
				: body;
		},
		{
			name: "get_artifact",
			description:
				"Fetch what a previous run in this conversation actually built: the stored route configuration or canvas (block graph) output. Pass the ids found in earlier summary tokens (sub_artifact_id / artifact_id), or a parent artifact id to get every output of that run. Each result reports whether it was applied. APPLIED means the user pushed it into the project and it is live — the result then carries the CURRENT state read straight from the database (real ids, current blocks), so do not call `find_resource` for it again. NOT APPLIED means it was only proposed and does not exist in the project; it has no real id and nothing can reference it. This distinction is internal — use it to shape your wording, never echo it to the user.",
			schema: z.object({
				artifactIds: z
					.array(z.string())
					.describe(
						"Sub-artifact ids taken verbatim from earlier summary tokens, or a parent artifact id. Pass several at once instead of calling repeatedly.",
					),
			}),
		},
	);
};

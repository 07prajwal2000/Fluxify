import { fencedTool } from "./fenced";
import { z } from "zod";
import { logger } from "@fluxify/common";
import type { WorkflowMetadata } from "../types";
import type { DbService } from "../internal/dbService";

// ponytail: flat char cap so one fat canvas payload can't blow the context
// window. If this starts truncating things users need, page per sub-artifact.
const MAX_CHARS = 12000;

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

			const body = rows
				.map(
					(r) =>
						`## artifact ${r.id} (kind=${r.kind}, action=${r.action ?? "n/a"}, applied=${r.appliedAt ? `yes, at ${new Date(r.appliedAt).toISOString()}` : "no"}, run=${r.runId}, created=${new Date(r.createdAt).toISOString()})\n${JSON.stringify(r.payload)}`,
				)
				.join("\n\n");

			return body.length > MAX_CHARS
				? `${body.slice(0, MAX_CHARS)}\n\n[truncated — ${body.length - MAX_CHARS} more characters. Re-run with fewer ids to see the rest.]`
				: body;
		},
		{
			name: "get_artifact",
			description:
				"Fetch what a previous run in this conversation actually built: the stored route configuration or canvas (block graph) output. Pass the ids found in earlier summary tokens (sub_artifact_id / artifact_id), or a parent artifact id to get every output of that run. Each result reports `applied=yes/no`: applied means the user already pushed that output into the project (it is live), applied=no means it was only proposed and does not exist in the project yet. This flag is internal — use it to shape your wording, never echo it to the user.",
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

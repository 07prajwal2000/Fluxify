import { type Tool, tool } from "ai";
import { z } from "zod";
import { RESOLVE_FINDING } from "../tools";
import { resolveFinding } from "./repository";

/**
 * Lets the agent mark the AI review finding it was asked to fix (#754), so the
 * report shows it fixed. Web runs only: it writes to the database directly, as
 * the job's user, who needed the creator role to send the message.
 */
export function resolveFindingTool(
	projectId: string,
	conversationId: string,
	resolve = resolveFinding,
): Tool {
	return tool({
		title: "Mark review finding",
		description:
			"Only when the user asked you to fix an AI review finding and gave its reviewId and finding number. Call it once you are done: fixed after the fix is saved, not_an_issue when the finding is wrong.",
		inputSchema: z.object({
			reviewId: z.string(),
			finding: z.number().int().min(0).describe("The finding number from the user's message"),
			outcome: z.enum(["fixed", "not_an_issue"]),
			note: z
				.string()
				.max(300)
				.optional()
				.describe("One sentence: what you changed, or why it is not an issue"),
		}),
		execute: async ({ reviewId, finding, outcome, note }) => {
			const ok = await resolve(reviewId, projectId, finding, {
				status: outcome,
				...(note && { note }),
				conversationId,
				at: new Date().toISOString(),
			});
			return ok
				? `Finding ${finding} marked ${outcome}.`
				: "No such finding: the review was run again since, or the number is wrong. Tell the user; nothing was marked.";
		},
	});
}

import { type Tool, tool } from "ai";
import { z } from "zod";
import { resolveFindings } from "./repository";

/**
 * Lets the agent mark the AI review findings it was asked to fix (#754, #1081),
 * several in one call, so the report shows them fixed. Web runs only: it writes
 * to the database directly, as the job's user, who needed the creator role to
 * send the message. Finding numbers are the ones the user's message shows, from 1.
 */
export function resolveFindingTool(
	projectId: string,
	conversationId: string,
	resolve = resolveFindings,
): Tool {
	return tool({
		title: "Mark review findings",
		description:
			"Only when the user asked you to fix AI review findings and gave a reviewId and finding numbers. Call it once when you are done, with one entry per finding the user's message still lists: fixed after the fix is saved, not_an_issue when the finding is wrong. Leave out findings you did not get to.",
		inputSchema: z.object({
			reviewId: z.string(),
			findings: z
				.array(
					z.object({
						finding: z
							.number()
							.int()
							.min(1)
							.describe("The finding number as the user's message shows it"),
						outcome: z.enum(["fixed", "not_an_issue"]),
						note: z
							.string()
							.max(300)
							.optional()
							.describe("One sentence: what you changed, or why it is not an issue"),
					}),
				)
				.min(1),
		}),
		execute: async ({ reviewId, findings }) => {
			const at = new Date().toISOString();
			const marked = new Set(
				await resolve(
					reviewId,
					projectId,
					findings.map((f) => ({
						index: f.finding - 1,
						resolution: {
							status: f.outcome,
							...(f.note && { note: f.note }),
							conversationId,
							at,
						},
					})),
				),
			);
			if (!marked.size)
				return "Nothing was marked: the review was run again since, or the numbers are wrong. Tell the user.";
			const lines = findings.map((f) =>
				marked.has(f.finding - 1)
					? `Finding ${f.finding} marked ${f.outcome}.`
					: `Finding ${f.finding}: no such finding, not marked.`,
			);
			return lines.join("\n");
		},
	});
}

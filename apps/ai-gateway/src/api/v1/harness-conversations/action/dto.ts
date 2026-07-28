import { z } from "zod";

export const routeParamsSchema = z.object({
	projectId: z.string().min(1),
	conversationId: z.string().min(1),
});

export const conversationActionEnum = z.enum([
	"pin",
	"unpin",
	"archive",
	"unarchive",
	"user_interrupt",
	"hitl_approve", // no reviews
	"hitl_review", // reviews required
	"hitl_reject", // no reviews
	"sub_artifact_applied", // sub_artifact required; safe to resend
]);

export const hitlReviewSchema = z.object({
	reviews: z.array(z.string()).optional(), // refine with if action is hitl_review
});

export const subArtifactSchema = z.object({
	subArtifactId: z.string().min(1),
});

export const requestBodySchema = z
	.object({
		action: conversationActionEnum,
		hitl_review: hitlReviewSchema.optional(),
		sub_artifact: subArtifactSchema.optional(),
	})
	.refine(
		(data) => {
			if (data.action === "hitl_review" && !data.hitl_review?.reviews) {
				return false;
			}
			return true;
		},
		{
			message: "hitl_review is required when action is hitl_review",
		},
	)
	.refine(
		(data) => data.action !== "sub_artifact_applied" || !!data.sub_artifact,
		{ message: "sub_artifact is required when action is sub_artifact_applied" },
	);

export type ConversationActionBody = z.infer<typeof requestBodySchema>;

export const responseSchema = z.object({
	id: z.string().optional(),
	pinned: z.boolean().optional(),
	archived: z.boolean().optional(),
	updatedAt: z.union([z.string(), z.date()]).optional(),
	appliedAt: z.union([z.string(), z.date()]).nullish(),
});

export type ConversationAction = z.infer<typeof conversationActionEnum>;

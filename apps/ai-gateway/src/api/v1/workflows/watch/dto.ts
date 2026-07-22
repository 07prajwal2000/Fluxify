import { z } from "zod";

export const requestBodySchema = z.object({});

export const requestRouteSchema = z.object({
	conversationId: z.string(),
});

export const watchResponseSchema = z.object({
	status: z.enum([
		"started",
		"running",
		"error",
		"success",
		"under_plan_review",
		"plan_rejected",
	]),
	conversationId: z.string(),
	userQuery: z.string(),
	currentNodeId: z.string(),
	executionHistory: z.array(
		z.object({
			name: z.string(),
			status: z.enum(["success", "failure", "running"]),
			type: z.enum(["tool", "node"]),
			input: z.any().optional(),
			output: z.any().optional(),
		}),
	),
	finalResult: z.any().optional(),
});

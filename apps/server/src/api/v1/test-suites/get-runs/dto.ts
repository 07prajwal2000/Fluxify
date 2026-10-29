import { z } from "zod";
import { testRunStatusEnum } from "../../../../db/schema";
import { paginationRequestQuerySchema, paginationResponseSchema } from "../../../../lib/pagination";
import { targetParamSchema } from "../../../../modules/testRunner/target";

export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
});

export const requestQuerySchema = paginationRequestQuerySchema.extend({
	suiteId: z.string().max(50).optional().describe("only runs that included this suite"),
});

export const runSummarySchema = z.object({
	id: z.string(),
	status: z.enum(testRunStatusEnum.enumValues),
	totalSuites: z.number(),
	/** which graph ran: the working copy, or the promoted version (both with development values) */
	env: z.enum(["development", "production"]),
	/** set when a promote's tests gate started this run */
	deploymentId: z.string().nullable(),
	/** disabled suites a "Run all" left out (#668) */
	skippedCount: z.number(),
	passedCount: z.number(),
	failedCount: z.number(),
	durationMs: z.number().nullable(),
	startedAt: z.any().nullable(),
	finishedAt: z.any().nullable(),
	createdAt: z.any(),
});

export const responseSchema = z.object({
	data: z.array(runSummarySchema),
	pagination: paginationResponseSchema,
});

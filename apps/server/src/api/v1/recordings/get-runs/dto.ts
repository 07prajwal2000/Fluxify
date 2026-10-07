import { z } from "zod";
import { traceOutcomeEnum } from "../../../../db/schema";
import { paginationRequestQuerySchema, paginationResponseSchema } from "../../../../lib/pagination";
import { targetParamSchema } from "../../../../modules/testRunner/target";

export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
});

export const requestQuerySchema = paginationRequestQuerySchema.extend({
	outcome: z.enum(traceOutcomeEnum.enumValues).optional(),
	from: z.coerce.date().optional().describe("runs started at or after this time"),
	to: z.coerce.date().optional().describe("runs started before this time"),
});

export const runSummarySchema = z.object({
	id: z.string(),
	outcome: z.enum(traceOutcomeEnum.enumValues),
	statusCode: z.number().nullable(),
	startedAt: z.any(),
	endedAt: z.any().nullable(),
	/** null while the run never finished */
	durationMs: z.number().nullable(),
	spanCount: z.number(),
	truncated: z.boolean(),
	droppedSpans: z.number(),
	parentRunId: z.string().nullable(),
});

export const responseSchema = z.object({
	data: z.array(runSummarySchema),
	pagination: paginationResponseSchema,
});

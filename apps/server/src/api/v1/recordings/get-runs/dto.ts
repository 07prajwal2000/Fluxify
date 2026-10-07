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
	source: z
		.enum(["test", "live"])
		.optional()
		.describe("test: only test run traces, live: only normal runs. Without it, both (#627)"),
	testRunId: z.string().max(50).optional().describe("only the traces of this test run"),
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
	/** null on a normal run; set on a test run's trace (#627) */
	metadata: z
		.object({
			source: z.literal("test"),
			label: z.string(),
			testRunId: z.string(),
			suiteId: z.string(),
			suiteName: z.string(),
			caseIndex: z.number(),
			caseName: z.string(),
		})
		.nullable(),
});

export const responseSchema = z.object({
	data: z.array(runSummarySchema),
	pagination: paginationResponseSchema,
});

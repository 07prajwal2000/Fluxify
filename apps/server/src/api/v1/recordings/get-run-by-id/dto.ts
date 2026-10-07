import { z } from "zod";
import { traceOutcomeEnum } from "../../../../db/schema";
import { targetParamSchema } from "../../../../modules/testRunner/target";
import { runSummarySchema } from "../get-runs/dto";

export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
	runId: z.uuid(),
});

export const responseSchema = runSummarySchema.extend({
	routeVersion: z.string().nullable(),
	workflowVersion: z.string().nullable(),
	parentSeq: z.number().nullable(),
	/** flat, ordered by `seq`; nest them with `parentSeq` */
	spans: z.array(
		z.object({
			seq: z.number(),
			parentSeq: z.number().nullable(),
			blockId: z.string(),
			blockType: z.string(),
			blockName: z.string().nullable(),
			customBlockId: z.string().nullable(),
			middleware: z.any().nullable(),
			startedAt: z.any(),
			endedAt: z.any(),
			outcome: z.enum(traceOutcomeEnum.enumValues),
			branch: z.enum(traceOutcomeEnum.enumValues).nullable(),
			error: z.string().nullable(),
			input: z.any().nullable(),
			output: z.any().nullable(),
			truncated: z.boolean(),
			/** test runs only (#627): what a suite's hook mocked */
			metadata: z
				.object({
					mocked: z.object({
						input: z.literal(true).optional(),
						output: z.literal(true).optional(),
					}),
				})
				.nullable(),
		}),
	),
	/** runs an async custom block forked off this run, and the span that forked each */
	childRuns: z.array(z.object({ id: z.string(), parentSeq: z.number().nullable() })),
});

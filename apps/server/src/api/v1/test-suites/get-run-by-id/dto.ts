import { z } from "zod";
import { testRunStatusEnum } from "../../../../db/schema";
import { runSummarySchema } from "../get-runs/dto";

export const requestParamSchema = z.object({
	projectId: z.string(),
	routeId: z.string(),
	runId: z.string(),
});

export const responseSchema = runSummarySchema.extend({
	result: z.any().nullable(),
	suiteRuns: z.array(
		z.object({
			id: z.string(),
			testSuiteId: z.string(),
			status: z.enum(testRunStatusEnum.enumValues),
			result: z.any().nullable(),
			durationMs: z.number().nullable(),
			startedAt: z.any().nullable(),
			finishedAt: z.any().nullable(),
		}),
	),
});

import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "../../../../lib/pagination";
import { testRunStatusEnum } from "../../../../db/schema";

export const requestParamSchema = z.object({
	projectId: z.string(),
	routeId: z.string(),
});

export const requestQuerySchema = paginationRequestQuerySchema;

export const runSummarySchema = z.object({
	id: z.string(),
	status: z.enum(testRunStatusEnum.enumValues),
	totalSuites: z.number(),
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

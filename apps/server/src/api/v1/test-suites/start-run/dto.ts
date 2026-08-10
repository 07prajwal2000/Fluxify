import { z } from "zod";

/**
 * `projectId` and `routeId` both come from the path so authorization needs no
 * database read: the ACL check runs against the path's project directly.
 * `startTestRun` still verifies the route actually belongs to that project —
 * otherwise passing your own project id would authorize someone else's route.
 */
export const requestParamSchema = z.object({
	projectId: z.string(),
	routeId: z.string(),
});

export const requestBodySchema = z.object({
	suiteIds: z
		.array(z.string())
		.optional()
		.describe("Suites to run; omit to run every suite on the route"),
});

export const responseSchema = z.object({
	runId: z.string(),
});

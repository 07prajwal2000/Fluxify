import { z } from "zod";
import { targetParamSchema } from "../../../../modules/testRunner/target";

/**
 * `projectId` and the target (route or workflow) both come from the path so authorization needs no
 * database read: the ACL check runs against the path's project directly.
 * `startTestRun` still verifies the target actually belongs to that project —
 * otherwise passing your own project id would authorize someone else's target.
 */
export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
});

export const requestBodySchema = z.object({
	suiteIds: z
		.array(z.string())
		.optional()
		.describe("Suites to run; omit to run every suite on the target"),
});

export const responseSchema = z.object({
	runId: z.string(),
});

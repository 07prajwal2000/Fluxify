import { z } from "zod";

export const referenceSchema = z.object({
	kind: z.enum(["route", "workflow", "custom_block", "middleware", "test_suite"]),
	id: z.string(),
	name: z.string(),
	/** the user's promoted version uses it: promoting or rolling back the subject changes what runs there */
	inProduction: z.boolean(),
	/** the user's working copy uses it: development runs it */
	inWorkingCopy: z.boolean(),
	/** a test suite's own route or workflow */
	target: z
		.object({ kind: z.enum(["route", "workflow"]), id: z.string(), name: z.string() })
		.optional(),
});

export const referencesResponseSchema = z.object({
	/** every user but sandboxes, sorted by kind and name */
	references: z.array(referenceSchema),
});

/** the 409 body of a delete that is refused while something uses the subject */
export const referencesConflictSchema = z.object({
	type: z.string(),
	message: z.string(),
	references: z.array(referenceSchema),
});

import { z } from "zod";

export const deployBodySchema = z.object({
	/** the version to put live; an older one than production's is a rollback */
	versionId: z.uuidv7(),
	/** why, in the user's words; kept in the log */
	description: z.string().trim().min(1).max(5000),
});

export const deploymentParamSchema = z.object({ id: z.uuidv7(), deploymentId: z.uuidv7() });

/** a route, workflow, custom block or middleware a gate names (#740) */
const gateRefSchema = z.object({
	kind: z.enum(["route", "workflow", "custom_block", "middleware"]),
	id: z.string(),
	name: z.string(),
	/** a failing suite of that route or workflow */
	suite: z.string().optional(),
	reason: z.string().optional(),
	runId: z.string().optional(),
});

export const gateSchema = z.object({
	gate: z.enum(["compile", "values", "path", "custom_blocks", "tests"]),
	status: z.enum(["passed", "failed", "warning", "skipped"]),
	message: z.string(),
	items: z
		.array(z.string())
		.optional() /** the tests gate's run, so the failed checks can be opened (#739) */,
	runId: z.string().optional(),
	/**
	 * What the message is about, with ids (#740): the custom blocks and
	 * middlewares with no production version (custom_blocks gate), or the failing
	 * suites of the routes and workflows that use what is promoted (tests gate)
	 */
	refs: z.array(gateRefSchema).optional(),
});

export const deploymentSchema = z.object({
	id: z.string(),
	kind: z.enum(["route", "workflow", "custom_block", "middleware"]),
	targetId: z.string(),
	versionId: z.string(),
	versionNumber: z.number().int(),
	action: z.enum(["promote", "rollback"]),
	description: z.string(),
	/** the author's name, else their email; null for an author who is gone and left none */
	author: z.string().nullable(),
	authorEmail: z.string().nullable(),
	/** pending while the gates run, then live or failed */
	status: z.enum(["pending", "live", "failed"]),
	gates: z.array(gateSchema),
	createdAt: z.string(),
	finishedAt: z.string().nullable(),
});

export const deploymentListSchema = z.object({
	/** newest first */
	deployments: z.array(deploymentSchema),
});

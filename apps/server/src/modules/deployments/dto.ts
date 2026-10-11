import { z } from "zod";

export const deployBodySchema = z.object({
	/** the version to put live; an older one than production's is a rollback */
	versionId: z.uuidv7(),
	/** why, in the user's words; kept in the log */
	description: z.string().trim().min(1).max(5000),
});

export const deploymentParamSchema = z.object({ id: z.uuidv7(), deploymentId: z.uuidv7() });

export const gateSchema = z.object({
	gate: z.enum(["compile", "values", "path", "custom_blocks", "tests"]),
	status: z.enum(["passed", "failed", "warning", "skipped"]),
	message: z.string(),
	items: z.array(z.string()).optional(),
});

export const deploymentSchema = z.object({
	id: z.string(),
	kind: z.enum(["route", "workflow"]),
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

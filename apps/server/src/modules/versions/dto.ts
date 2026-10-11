import { z } from "zod";

export const commitBodySchema = z.object({
	/** names the piece of work, e.g. "Add rate limiting" — shown in the history */
	title: z.string().trim().min(1).max(255),
	description: z.string().max(5000).optional(),
});

export const checkoutBodySchema = z.object({
	/** names the version that saves uncommitted work first; "Saved before checking out vN" when omitted */
	title: z.string().trim().min(1).max(255).optional(),
});

export const versionParamSchema = z.object({ id: z.uuidv7(), versionId: z.uuidv7() });

export const versionSchema = z.object({
	id: z.string(),
	kind: z.enum(["route", "workflow"]),
	targetId: z.string(),
	versionNumber: z.number().int(),
	title: z.string(),
	description: z.string().nullable(),
	/** the author's name, else their email; null for an author who is gone and left none */
	author: z.string().nullable(),
	authorEmail: z.string().nullable(),
	createdAt: z.string(),
	parentId: z.string().nullable(),
	/** the version the working copy came from */
	isHead: z.boolean(),
	/** the version production serves (#739) */
	isProd: z.boolean(),
});

export const versionListSchema = z.object({
	/** newest first */
	versions: z.array(versionSchema),
	/** the working copy has changes no version holds */
	uncommitted: z.boolean(),
});

export const versionDetailSchema = versionSchema.extend({
	snapshot: z.object({
		blocks: z.array(z.any()),
		edges: z.array(z.any()),
		settings: z.record(z.string(), z.any()),
	}),
});

export const checkoutResultSchema = z.object({
	/** the uncommitted work, saved first; absent when there was none */
	savedVersion: versionSchema.optional(),
	checkedOut: versionSchema,
	/** the working copy's revision after the checkout, for the next edit */
	canvasRevision: z.number().int(),
	warnings: z.array(z.string()),
});

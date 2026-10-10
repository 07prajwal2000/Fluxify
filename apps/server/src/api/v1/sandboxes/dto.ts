import { z } from "zod";

/** Every endpoint is under its project, so access costs no read before the owner check. */
export const projectParamSchema = z.object({ projectId: z.string().min(1).max(50) });
export const idParamSchema = projectParamSchema.extend({ id: z.string().min(1).max(50) });
export const runParamSchema = idParamSchema.extend({ runId: z.uuid() });

/** Recording is always on in a sandbox, so it is not a setting. */
export const settingsSchema = z.object({
	/** spans exported to the project's OTEL destination */
	tracingEnabled: z.boolean(),
});

export const createSchema = z.object({
	name: z.string().trim().min(1).max(255),
	settings: settingsSchema.partial().optional(),
});

export const patchSchema = createSchema.partial();

export const createdSchema = z.object({ id: z.string() });

export const sandboxSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	name: z.string(),
	settings: settingsSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const listSchema = z.object({ data: z.array(sandboxSchema) });

import z from "zod";

export const requestRouteSchema = z.object({
	id: z.uuidv7(),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string().min(1).max(255),
	path: z.string(),
	/** production's switch; `devActive` is development's (#738) */
	active: z.boolean(),
	devActive: z.boolean(),
	method: z.string(),
	projectId: z.string(),
	projectName: z.string(),
	bodySchema: z.any().optional(),
	querySchema: z.any().optional(),
	paramsSchema: z.any().optional(),
	timeoutSeconds: z.number().int(),
	/** production's; development has its own pair (#736) */
	tracingEnabled: z.boolean(),
	recordExecution: z.boolean(),
	devTracingEnabled: z.boolean(),
	devRecordExecution: z.boolean(),
	acceptedContentTypes: z.array(z.string()),
	/** the number of the version the working copy came from; null before the first (#738) */
	headVersionNumber: z.number().int().nullable(),
	/** the version production serves; null until one is promoted (#739) */
	prodVersionId: z.string().nullable(),
	prodVersionNumber: z.number().int().nullable(),
	/** the working copy has changes no version holds */
	uncommitted: z.boolean(),
	createdAt: z.string(),
	createdBy: z.string(),
	updatedAt: z.string(),
});

import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	integrationId: z.uuidv7("Invalid integration id"),
});

export const schemaQuerySchema = z.object({
	/** comma separated; omit for names only */
	tables: z.string().optional(),
});

export const kvQuerySchema = z.object({
	key: z.string().min(1, "key is required"),
});

export const kvResponseSchema = z.object({
	key: z.string(),
	found: z.boolean(),
	value: z.string().nullable(),
	truncated: z.boolean(),
	/** seconds left; null = no expiry, or unknown (see ttlNote) */
	ttlSeconds: z.number().nullable(),
	ttlNote: z.string().optional(),
});

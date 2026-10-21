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
	/** whose credentials to connect with; development unless asked */
	env: z.enum(["development", "production"]).default("development"),
});

/** `POST /:integrationId/inspect`: whose credentials to connect with; development unless asked */
export const inspectQuerySchema = z.object({
	env: z.enum(["development", "production"]).default("development"),
});

/** the variant defines and validates the rest */
export const inspectBodySchema = z.record(z.string(), z.unknown());

export const kvResponseSchema = z.object({
	key: z.string(),
	found: z.boolean(),
	value: z.string().nullable(),
	truncated: z.boolean(),
	/** seconds left; null = no expiry, or unknown (see ttlNote) */
	ttlSeconds: z.number().nullable(),
	ttlNote: z.string().optional(),
});

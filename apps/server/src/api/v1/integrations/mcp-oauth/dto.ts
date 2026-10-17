import { z } from "zod";

export const envSchema = z.enum(["development", "production"]);
export type Env = z.infer<typeof envSchema>;

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	id: z.uuidv7("Invalid integration id"),
});

export const callbackRouteSchema = requestRouteSchema.pick({ projectId: true });

/** Which environment's connection: dev and prod connect separately. */
export const requestBodySchema = z.object({ env: envSchema });

export const connectResponseSchema = z.object({
	/** where to send the person to sign in to the MCP server */
	authorizationUrl: z.string(),
});

export const disconnectResponseSchema = z.object({ connected: z.literal(false) });

/** What the MCP server puts on the address it sends the browser back to. */
export const callbackQuerySchema = z.object({
	state: z.string().min(1),
	code: z.string().optional(),
	error: z.string().optional(),
});

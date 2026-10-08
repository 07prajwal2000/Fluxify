import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	id: z.uuidv7("Invalid integration id"),
});

/**
 * Observability only: which OTLP signal to probe. One endpoint can be a
 * project's traces destination without being its metrics one, so the test has
 * to hit the same path that signal's exporter will.
 */
export const requestQuerySchema = z.object({
	signal: z.enum(["logs", "traces", "metrics"]).default("logs"),
});

export const responseSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
});

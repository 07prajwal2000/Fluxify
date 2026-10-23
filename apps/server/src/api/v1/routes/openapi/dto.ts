import z from "zod";

export const requestParamSchema = z.object({
	projectId: z.string().min(1),
});

export const requestQuerySchema = z.object({
	env: z.enum(["prod", "production", "dev", "development"]).optional(),
});

export type OpenApiEnv = "production" | "development";

export function normalizeEnv(env?: string): OpenApiEnv {
	if (env === "dev" || env === "development") return "development";
	return "production";
}

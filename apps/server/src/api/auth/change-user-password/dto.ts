import { z } from "zod";

export const requestParamsSchema = z.object({
	userId: z.string(),
});

export const requestBodySchema = z.object({
	newPassword: z.string().min(8, "Password must be at least 8 characters long"),
});

export const responseSchema = z.object({
	message: z.string(),
});

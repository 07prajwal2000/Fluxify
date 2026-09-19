import z from "zod";

export const requestBodySchema = z.object({
	email: z.email(),
	isSystemAdmin: z.boolean().default(false),
	password: z.string().optional(),
	fullname: z.string().optional(),
	provider: z.enum(["email-password", "sso"]).default("email-password"),
});

export const responseSchema = z.object({
	id: z.string(),
});

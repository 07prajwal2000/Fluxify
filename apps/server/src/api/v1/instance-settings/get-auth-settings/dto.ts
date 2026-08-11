import z from "zod";

export const responseSchema = z.object({
	type: z.enum(["traditional", "sso"]),
	sso_config: z.record(z.string(), z.unknown()),
});

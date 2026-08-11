import z from "zod";
import { ssoConfigSchema } from "../../../../lib/instance-settings/schemas";

// enabled is derived from `type`, never sent by the client
const ssoConfigPatchSchema = ssoConfigSchema.omit({ enabled: true }).partial();

export const requestBodySchema = z.object({
	type: z.enum(["traditional", "sso"]),
	sso_config: ssoConfigPatchSchema.optional(),
});

export const responseSchema = z.object({
	message: z.string(),
	type: z.enum(["traditional", "sso"]),
	sso_config: z.record(z.string(), z.unknown()),
});

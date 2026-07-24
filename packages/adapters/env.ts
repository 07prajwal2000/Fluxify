import { baseEnvSchema, createEnvValidator } from "@fluxify/common";
import { z } from "zod";

export const adaptersEnvSchema = baseEnvSchema.pick({
	CI: true,
});

export type AdaptersEnvKey = keyof z.infer<typeof adaptersEnvSchema>;

const validator = createEnvValidator(adaptersEnvSchema, "Adapters");
export const validateEnv = validator.validateEnv;
export const getEnv = validator.getEnv;

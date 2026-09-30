import z from "zod";
import { baseRequestBodySchema, validatePremadeIcon } from "../create/dto";

export const requestParamSchema = z.object({
	id: z.string(),
});

export const requestBodySchema = baseRequestBodySchema
	// usage is fixed at create (#534): what already calls the block depends on it
	.omit({ projectId: true, name: true, usage: true })
	.partial()
	.superRefine(validatePremadeIcon);

export const responseSchema = z.object({
	id: z.string(),
});

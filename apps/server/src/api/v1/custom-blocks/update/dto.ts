import z from "zod";
import { baseRequestBodySchema, validatePremadeIcon } from "../create/dto";

export const requestParamSchema = z.object({
  id: z.string(),
});

export const requestBodySchema = baseRequestBodySchema.omit({ projectId: true, name: true }).partial().superRefine(validatePremadeIcon);

export const responseSchema = z.object({
  id: z.string(),
});

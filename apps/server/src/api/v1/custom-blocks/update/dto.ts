import z from "zod";
import { requestBodySchema as createRequestBodySchema } from "../create/dto";

export const requestParamSchema = z.object({
  id: z.string(),
});

export const requestBodySchema = createRequestBodySchema.omit({ projectId: true, name: true }).partial();

export const responseSchema = z.object({
  id: z.string(),
});

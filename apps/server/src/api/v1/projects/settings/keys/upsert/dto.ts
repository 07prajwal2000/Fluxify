import { z } from "zod";
import { ProjectSettingsKeyType } from "../keySchemaMap";

export const requestBodySchema = z.object({
  key: z.string<ProjectSettingsKeyType>(),
  value: z.string().optional(),
});

export const responseSchema = z.object({
  message: z.string(),
});

export type RequestBodySchema = z.infer<typeof requestBodySchema>;
export type ResponseSchema = z.infer<typeof responseSchema>;

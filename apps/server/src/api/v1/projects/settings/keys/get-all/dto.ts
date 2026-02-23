import { z } from "zod";
import { ProjectSettingsKeyType } from "../keySchemaMap";

export const responseSchema = z.record(
  z.string<ProjectSettingsKeyType>(),
  z.string(),
);

export type ResponseSchema = z.infer<typeof responseSchema>;

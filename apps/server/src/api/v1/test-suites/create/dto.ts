import { testSuiteCoreSchema } from "../schema";
import { z } from "zod";

export const requestBodySchema = testSuiteCoreSchema;

export const responseSchema = z.object({
  id: z.string(),
});

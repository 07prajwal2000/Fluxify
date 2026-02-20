import { testSuiteCoreSchema } from "../schema";
import { z } from "zod";

export const requestBodySchema = testSuiteCoreSchema.partial();
export const requestRouteSchema = z.object({
  id: z.string(),
});

export const responseSchema = z.object({
  id: z.string(),
});

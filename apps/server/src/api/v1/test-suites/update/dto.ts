import { z } from "zod";
import { testSuiteCoreSchema } from "../schema";

export const requestBodySchema = testSuiteCoreSchema.partial();
export const requestRouteSchema = z.object({
	id: z.string(),
});

export const responseSchema = z.object({
	id: z.string(),
});

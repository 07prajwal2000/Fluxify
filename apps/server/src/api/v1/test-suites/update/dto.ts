import { z } from "zod";
import { testSuiteCoreSchema } from "../schema";

// a suite never moves to another target: that is cloning (#497)
export const requestBodySchema = testSuiteCoreSchema
	.omit({ routeId: true, workflowId: true })
	.partial();
export const requestRouteSchema = z.object({
	id: z.string(),
});

export const responseSchema = z.object({
	id: z.string(),
});

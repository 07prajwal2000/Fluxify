import { z } from "zod";
import { testSuiteCoreSchema } from "../schema";

export const requestRouteSchema = z.object({
	id: z.string().uuid(),
});

export const responseSchema = testSuiteCoreSchema
	.extend({
		id: z.string().uuid(),
		createdAt: z.any().optional(),
		updatedAt: z.any().optional(),
		routeId: z.string().nullable(),
		workflowId: z.string().nullable(),
		routeParams: z.any(),
		queryParams: z.any(),
	})
	.partial();

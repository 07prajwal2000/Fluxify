import { z } from "zod";
import { suiteTargetTypeSchema } from "../../../../modules/testRunner/target";

export const requestRouteSchema = z.object({
	id: z.string(),
});

/** the route or workflow of the same project the copy lands on */
export const requestBodySchema = z.object({
	kind: suiteTargetTypeSchema,
	targetId: z.string(),
});

export const responseSchema = z.object({
	id: z.string(),
	/** names of the blocks whose hooks had no match on the target */
	droppedHooks: z.array(z.string()),
});

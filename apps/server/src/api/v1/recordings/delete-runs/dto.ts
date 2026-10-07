import { z } from "zod";
import { targetParamSchema } from "../../../../modules/testRunner/target";

export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
});

export const responseSchema = z.object({
	deleted: z.number(),
});

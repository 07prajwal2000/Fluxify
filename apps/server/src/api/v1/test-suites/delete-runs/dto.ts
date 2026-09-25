import { z } from "zod";
import { targetParamSchema } from "../../../../modules/testRunner/target";

/** Same path shape as the other run endpoints — authorization reads the project
 *  straight off the path, no database round trip. */
export const requestParamSchema = targetParamSchema.extend({
	projectId: z.string(),
});

export const responseSchema = z.object({
	deleted: z.number(),
});

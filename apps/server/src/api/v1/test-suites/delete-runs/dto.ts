import { z } from "zod";

/** Same path shape as the other run endpoints — authorization reads the project
 *  straight off the path, no database round trip. */
export const requestParamSchema = z.object({
	projectId: z.string(),
	routeId: z.string(),
});

export const responseSchema = z.object({
	deleted: z.number(),
});

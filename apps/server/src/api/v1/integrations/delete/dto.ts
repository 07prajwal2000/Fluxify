import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	id: z.uuidv7(),
});

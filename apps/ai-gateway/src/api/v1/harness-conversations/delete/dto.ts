import { z } from "zod";

export const routeParamsSchema = z.object({
	conversationId: z.string().min(1),
});

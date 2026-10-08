import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	id: z.uuidv7("Invalid integration id"),
});

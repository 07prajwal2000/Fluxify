import { z } from "zod";

export const requestRouteSchema = z.object({
  id: z.string().uuid(),
});

export const responseSchema = z.object({
  success: z.boolean(),
});

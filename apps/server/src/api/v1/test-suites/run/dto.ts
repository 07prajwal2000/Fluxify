import { z } from "zod";

export const requestRouteSchema = z.object({
  id: z.string().uuid(),
});

export const responseSchema = z.object({
  success: z.boolean(),
  result: z.array(
    z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  ),
});

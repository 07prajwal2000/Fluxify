import { z } from "zod";

export const requestQuerySchema = z.object({
  route_id: z.string().uuid(),
});

export const responseSchema = z.object({
  success: z.boolean(),
  result: z.array(
    z.object({
      suite_id: z.string(),
      success: z.boolean(),
      name: z.string().optional(),
      errors: z.array(z.string()).optional(),
      assertions: z.array(z.object({
        success: z.boolean(),
        message: z.string(),
      })).optional(),
      actualData: z.unknown().optional(),
    }),
  ),
});

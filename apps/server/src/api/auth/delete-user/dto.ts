import { z } from "zod";

export const requestParamsSchema = z.object({
  userId: z.string(),
});

export const responseSchema = z.object({
  message: z.string(),
});

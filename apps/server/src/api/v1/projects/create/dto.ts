import { z } from "zod";

export const requestBodySchema = z.object({
  name: z.string().min(2).max(100),
});

export const responseSchema = z.object({ id: z.string() });

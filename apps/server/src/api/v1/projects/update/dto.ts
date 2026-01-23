import { z } from "zod";

export const requestRouteSchema = z.object({
  id: z.uuidv7(),
});

export const requestBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  hidden: z.boolean().optional(),
});

export const responseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  hidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

import { z } from "zod";

export const requestRouteSchema = z.object({
  id: z.uuidv7(),
});

export const requestBodySchema = z.object({
  // 50, not 255: `projects.name` is varchar(50), so a longer name passed
  // validation and then died on the update.
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(1000).optional(),
  hidden: z.boolean().optional(),
});

export const responseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  hidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

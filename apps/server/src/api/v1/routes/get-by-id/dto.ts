import z from "zod";

export const requestRouteSchema = z.object({
  id: z.uuidv7(),
});

export const responseSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  path: z.string(),
  active: z.boolean(),
  method: z.string(),
  projectId: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  projectName: z.string(),
});

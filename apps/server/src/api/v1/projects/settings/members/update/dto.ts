import z from "zod";

export const requestParamSchema = z.object({ userId: z.string() });
export const requestBodySchema = z.object({
  role: z.enum(["viewer", "creator", "project_admin"]),
});

export const responseSchema = z.object({
  id: z.number(),
  userId: z.string().nullable(),
  projectId: z.string().nullable(),
  role: z.enum(["viewer", "creator", "project_admin", "system_admin"]),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

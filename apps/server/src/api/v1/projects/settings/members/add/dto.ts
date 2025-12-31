import z from "zod";

export const requestBodySchema = z.object({
  userId: z.string(),
  role: z.enum(["viewer", "creator", "project_admin"]),
});

export const responseSchema = z.object({ id: z.number() });

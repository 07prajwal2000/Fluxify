import z from "zod";

export const requestParamSchema = z.object({
  projectId: z.string().min(1),
});

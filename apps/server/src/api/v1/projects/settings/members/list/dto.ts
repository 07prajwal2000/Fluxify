import z from "zod";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../../../../../lib/pagination";

export const requestQuerySchema = z.clone(paginationRequestQuerySchema).extend({
  role: z
    .enum(["viewer", "creator", "project_admin", "system_admin", ""])
    .optional(),
  name: z.string().optional(),
});

export const responseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      name: z.string(),
      role: z.enum(["viewer", "creator", "project_admin", "system_admin"]),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  pagination: paginationResponseSchema,
});

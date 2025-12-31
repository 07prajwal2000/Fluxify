import z from "zod";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../../lib/pagination";

export const requestBodySchema = paginationRequestQuerySchema.extend(
  z.object({
    fuzzySearch: z.string().optional(),
  }).shape
);

export const responseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      isSystemAdmin: z.boolean(),
      role: z.enum(["user", "instance_admin"]),
    })
  ),
  pagination: paginationResponseSchema,
});

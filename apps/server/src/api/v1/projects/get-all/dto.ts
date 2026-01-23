import { z } from "zod";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../../../lib/pagination";

export const requestQuerySchema = z.clone(paginationRequestQuerySchema);

export const responseSchema = z.object({
  data: z.array(
    z.object({
      createdAt: z.string(),
      updatedAt: z.string(),
      id: z.string(),
      name: z.string(),
    }),
  ),
  pagination: paginationResponseSchema,
});

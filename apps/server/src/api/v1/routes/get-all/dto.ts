import z from "zod";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../../../lib/pagination";

export const fieldEnumSchema = z.enum([
  "",
  "id",
  "name",
  "path",
  "active",
  "method",
]);

// ?filter.field=FIELD&filter.value=something&filter.operator=eq
export const requestQuerySchema = z
  .clone(paginationRequestQuerySchema)
  .extend({
    "filter.field": fieldEnumSchema.optional(),
    "filter.operator": z
      .enum(["eq", "neq", "gt", "gte", "lt", "lte", "like"])
      .optional(),
    "filter.value": z.string().optional(),
    projectId: z.uuidv7().optional(),
  })
  .transform((q) => ({
    page: q.page,
    perPage: q.perPage,
    filter: {
      field: q["filter.field"],
      operator: q["filter.operator"],
      value: q["filter.value"],
      projectId: q["projectId"],
    },
  }));

export const responseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      path: z.string().nullable(),
      active: z.boolean().nullable(),
      method: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
      projectId: z.string(),
      projectName: z.string(),
    })
  ),
  pagination: paginationResponseSchema,
});

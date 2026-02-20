import { z } from "zod";

// --- Assertions Schema --- //
export const assertionSchema = z
  .object({
    target: z.enum(["status", "body", "time", "header", "custom_js"]),
    property_path: z.string().optional().nullable(),
    operator: z
      .enum([
        "eq",
        "neq",
        "lt",
        "gt",
        "contains",
        "true",
        "false",
        "exists",
        "not_exists",
      ])
      .optional()
      .nullable(),
    expected_value: z.string().optional().nullable(),
    custom_js: z.string().optional().nullable(),
  })
  .superRefine((val, ctx) => {
    // 1. Property path
    if (
      val.target !== "body" &&
      val.property_path != null &&
      val.property_path !== ""
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["property_path"],
        message: "property_path must be absent or null unless target is 'body'",
      });
    }

    // 2. Operators mapping
    const operatorsForTarget: Record<string, string[]> = {
      status: ["eq", "neq", "lt", "gt"],
      time: ["eq", "neq", "lt", "gt"],
      body: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
      header: [
        "eq",
        "neq",
        "contains",
        "true",
        "false",
        "exists",
        "not_exists",
      ],
    };

    if (val.target !== "custom_js") {
      if (!val.operator) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operator"],
          message: "Operator is required",
        });
      } else if (!operatorsForTarget[val.target]?.includes(val.operator)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operator"],
          message: `Operator '${val.operator}' is not allowed for target '${val.target}'`,
        });
      }

      if (
        val.expected_value == null &&
        val.operator !== "true" &&
        val.operator !== "false" &&
        val.operator !== "exists" &&
        val.operator !== "not_exists"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expected_value"],
          message: "Expected value is required",
        });
      }
    }
  });

export const testSuiteCoreSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  route_id: z.string().uuid("Invalid route ID"),
  params: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  query_params: z.record(z.string(), z.string()).default({}),
  route_params: z.record(z.string(), z.string()).default({}),
  body: z.record(z.string(), z.unknown()).optional().nullable(),
  assertions: z.array(assertionSchema).default([]),
});

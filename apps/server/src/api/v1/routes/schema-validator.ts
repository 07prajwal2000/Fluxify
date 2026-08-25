import { z } from "zod";
import { ValidationSchemaZod } from "../../../lib/validationSchemaZod";

/** Path variables declared in a route path: "/users/:id/posts/:postId" => ["id", "postId"] */
export function extractPathParams(path: string): string[] {
  return Array.from(path.matchAll(/:([a-zA-Z0-9_]+)/g)).map((match) => match[1]);
}

/**
 * The path is the only source of truth for which params exist, so a path with
 * no `:params` can never have a params schema.
 *
 * Editing `/users/:id` down to `/users/without-params` used to leave the old
 * schema behind: clients drop the field once there is nothing to describe, and
 * an omitted field is skipped by the update statement rather than nulled — so
 * the dead schema survived the edit and kept validating params that could no
 * longer be supplied.
 *
 * Applied BEFORE the validation refinement, so a client that still sends the
 * stale schema has it cleared instead of being rejected with a confusing 400.
 */
export function normalizeParamsSchema<T extends { path: string; paramsSchema?: any }>(
  data: T,
): T {
  if (extractPathParams(data.path).length > 0) return data;
  return { ...data, paramsSchema: null };
}

/**
 * Validates the route schemas including body, query, and params schemas.
 * Also verifies that path parameters defined in the route path actually exist in the paramsSchema.
 */
export function validateRouteSchemas(data: {
  path: string;
  bodySchema?: any;
  querySchema?: any;
  paramsSchema?: any;
}) {
  const { path, bodySchema, querySchema, paramsSchema } = data;
  const errors: { path: string; message: string }[] = [];
  const pathParams = extractPathParams(path);

  // Validate body schema structural correctness
  if (bodySchema) {
    const parsed = ValidationSchemaZod.safeParse(bodySchema);
    if (!parsed.success) {
      errors.push({ path: "bodySchema", message: "Invalid body schema format" });
    }
  }

  // Validate query schema structural correctness
  if (querySchema) {
    const parsed = ValidationSchemaZod.safeParse(querySchema);
    if (!parsed.success) {
      errors.push({ path: "querySchema", message: "Invalid query schema format" });
    }
  }

  // Validate params schema structural correctness
  if (pathParams.length > 0 && !paramsSchema) {
    errors.push({ path: "paramsSchema", message: "Route path parameters require a paramsSchema" });
  } else if (paramsSchema) {
    const parsed = ValidationSchemaZod.safeParse(paramsSchema);
    if (!parsed.success) {
      errors.push({ path: "paramsSchema", message: "Invalid params schema format" });
    } else {
      const properties = paramsSchema.properties || [];
      const schemaParamKeys = properties.map((p: any) => p.key);

      for (const param of pathParams) {
        if (!schemaParamKeys.includes(param)) {
          errors.push({
            path: "paramsSchema",
            message: `Path parameter '${param}' is missing from paramsSchema`,
          });
        }
      }
      
      for (const param of schemaParamKeys) {
        if (!pathParams.includes(param)) {
          errors.push({
            path: "paramsSchema",
            message: `paramsSchema contains parameter '${param}' which is not in the route path`,
          });
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

// Reusable zod refinement for route schema validations
export const routeSchemaValidationRefinement = (data: any, ctx: z.RefinementCtx) => {
  const result = validateRouteSchemas(data);
  if (!result.success) {
    for (const error of result.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [error.path],
        message: error.message,
      });
    }
  }
};

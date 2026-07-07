import { z } from "zod";
import { ValidationSchemaZod } from "../../../lib/validationSchemaZod";

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
  if (paramsSchema) {
    const parsed = ValidationSchemaZod.safeParse(paramsSchema);
    if (!parsed.success) {
      errors.push({ path: "paramsSchema", message: "Invalid params schema format" });
    } else {
      // Extract path variables from route path (e.g. /users/:userId => ['userId'])
      const pathParams = Array.from(path.matchAll(/:([a-zA-Z0-9_]+)/g)).map((match) => match[1]);
      
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

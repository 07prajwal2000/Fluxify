import { z } from "zod";
import { JsVM } from "../vm";
import { is } from "zod/v4/locales";

export const operatorSchema = z
  .enum(["eq", "neq", "gt", "gte", "lt", "lte", "js", "is_empty", "is_not_empty"])
  .describe("The operator to use for comparison");

export const conditionSchema = z.object({
  // if it is prefixed with `js:` then it will use vm which is created for the request's context
  lhs: z
    .string()
    .or(z.number().or(z.boolean()))
    .describe("left-hand side operator (can be js expression)"),
  rhs: z
    .string()
    .or(z.number().or(z.boolean()))
    .describe("right-hand side operator (can be js expression)"),
  operator: operatorSchema,
  js: z.string().optional().describe("javascript expression"),
  chain: z
    .enum(["and", "or"])
    .default("and")
    .describe("condition chain to use for evaluation"),
});

export async function evaluateOperator(
  vm: JsVM,
  lhs: any,
  rhs: any,
  operator: z.infer<typeof operatorSchema>,
  js?: string,
  extras?: any
): Promise<boolean> {
  const isLhsScript = typeof lhs == "string" && lhs.startsWith("js:");
  const isRhsScript = typeof rhs == "string" && rhs.startsWith("js:");

  if (operator == "js" && !!js) {
    const result = await vm.run(js.startsWith("js:") ? js.slice(3) : js, extras);
    return vm.truthy(result);
  } else if (isLhsScript || isRhsScript) {
    lhs = isLhsScript ? await vm.run(lhs.slice(3), extras) : lhs;
    rhs = isRhsScript ? await vm.run(rhs.slice(3), extras) : rhs;
    return evaluateOperator(vm, lhs, rhs, operator);
  } else {
    switch (operator) {
      case "eq":
        return lhs == rhs;
      case "neq":
        return lhs != rhs;
      case "gt":
        return lhs > rhs;
      case "gte":
        return lhs >= rhs;
      case "lt":
        return lhs < rhs;
      case "lte":
        return lhs <= rhs;
      case "is_empty":
        return isNull(lhs);
      case "is_not_empty":
        return !isNull(lhs);
      default:
        return false;
    }
  }
}

function isNull(value: any): boolean {
  return value === null || isUndefined(value) || isNaN(value) || value === "" || isObjectEmpty(value) || isArrayEmpty(value);
}

function isUndefined(value: any): boolean {
  return value === undefined;
}

function isObjectEmpty(obj: any): boolean {
  return (typeof obj === "object" && Object.keys(obj).length === 0);
}
function isArrayEmpty(obj: any): boolean {
  return Array.isArray(obj) && obj.length === 0;
}

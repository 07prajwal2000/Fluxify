import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";
import { conditionSchema } from "@fluxify/lib";
import { ConditionEvaluator } from "./conditionEvaluator";

export const arrayOperationsEnumSchema = z.enum([
  "push",
  "pop",
  "shift",
  "unshift",
  "filter",
]);

export const arrayOperationsBlockSchema = z
  .object({
    operation: arrayOperationsEnumSchema.describe(
      "type of operation to perform",
    ),
    value: z
      .any()
      .optional()
      .describe("the value to insert (if insert operation is made)"),
    useParamAsInput: z
      .boolean()
      .optional()
      .describe(
        "use the parameter as the datasource (passed from previous block's output)",
      ),
    datasource: z
      .string()
      .describe("global variable to perform the operation on"),
    filterConditions: z
      .array(conditionSchema)
      .optional()
      .describe("list of conditions which are evaluated"),
  })
  .extend(baseBlockDataSchema.shape);

export const arrayOperationsAiDescription = {
  name: "array_operations",
  description: `handles array operations on a variable (supports push, pop, shift, unshift)`,
  jsonSchema: JSON.stringify(z.toJSONSchema(arrayOperationsBlockSchema)),
};

export class ArrayOperationsBlock extends BaseBlock {
  public async executeAsync(params?: any): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof arrayOperationsBlockSchema>;
    let array = this.context.vars[input.datasource];
    if (!Array.isArray(array)) {
      return {
        continueIfFail: false,
        successful: false,
        error: "datasource is not an array",
      };
    }
    if (input.useParamAsInput) {
      input.value = params;
    }
    if (
      input.value === undefined &&
      input.operation !== "pop" &&
      input.operation !== "shift" &&
      input.operation !== "filter"
    ) {
      return {
        continueIfFail: false,
        successful: false,
        error: "value is required for array operation block",
      };
    }
    let value = input.value;
    if (input.operation === "push" || input.operation === "unshift") {
      value =
        typeof value == "string"
          ? value.startsWith("js:")
            ? await this.context.vm.runAsync(value.slice(3))
            : value
          : value;
    }
    switch (input.operation) {
      case "push":
        array.push(value);
        break;
      case "pop":
        array.pop();
        break;
      case "shift":
        array.shift();
        break;
      case "unshift":
        array.unshift(value);
        break;
      case "filter":
        array = array.filter((item) =>
          ConditionEvaluator.evaluateOperatorsList(
            input.filterConditions || [],
            this.context.vm,
            item,
          ),
        );
        this.context.vars[input.datasource] = array;
        break;
    }
    return {
      continueIfFail: true,
      successful: true,
      output: array,
      next: this.next,
    };
  }
}

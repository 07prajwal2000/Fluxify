import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import type { EmitNode } from "../compiler";

export const setVarSchema = z
  .object({
    key: z.string().describe("The name of the variable"),
    value: z
      .any()
      .describe(
        "The value of the variable (can be number,bool,string,object or js expression)",
      ),
  })
  .extend(baseBlockDataSchema.shape)
  .describe("A useful block to set a variable in the context");

export const setVarBlockAiDescription = {
  name: BlockTypes.setvar,
  description:
    "Assigns a value to a variable in the global execution context.",
  jsonSchema: JSON.stringify(z.toJSONSchema(setVarSchema)),
};

export function emitSetVar(node: EmitNode) {
  const { key, value } = setVarSchema.parse(node.block.data);
  return `${node.in} = vars[${JSON.stringify(key)}] = ${node.value(value)};\n${node.next()}`;
}

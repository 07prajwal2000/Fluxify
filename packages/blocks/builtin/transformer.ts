import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import type { EmitNode } from "../compiler";

export const transformerBlockSchema = z
  .object({
    fieldMap: z
      .record(z.string(), z.string())
      .describe(
        "key value pairs which map the source key to destination object's key",
      ),
    js: z
      .string()
      .optional()
      .describe(
        "js code executed when useJs is enabled. A global variable 'input' which stores the source object",
      ),
    useJs: z.boolean().default(false).describe("enable to run the js code"),
  })
  .extend(baseBlockDataSchema.shape);

export const transformBlockAiDescription = {
  name: BlockTypes.transformer,
  description:
    "Transforms input data into a new structure using JavaScript.",
  jsonSchema: JSON.stringify(z.toJSONSchema(transformerBlockSchema)),
};

export function emitTransformer(node: EmitNode) {
  const { fieldMap, js, useJs } = transformerBlockSchema.parse(node.block.data);
  if (useJs) {
    return `${node.in} = ${node.js(js || "", node.in)};\n${node.next()}`;
  }
  const fields = Object.entries(fieldMap).map(
    ([from, to]) => `${JSON.stringify(to)}: ${node.in}[${JSON.stringify(from)}]`,
  );
  return `${node.in} = { ${fields.join(", ")} };\n${node.next()}`;
}


import { BlockTypes } from "../blockTypes";
import z from "zod";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";
import { httpcodes } from "@fluxify/lib";
import type { EmitNode } from "../compiler";

export const responseBlockSchema = z
  .object({
    httpCode: z.string().refine((x) => httpcodes.some((y) => y.code == x)),
  })
  .extend(baseBlockDataSchema.shape);

export const responseAiDescription = {
  name: BlockTypes.response,
  description:
    "Terminates the request and returns the result to the client. Only sets the status code — the response body is whatever the previous block output, so shape the body in the block feeding this one.",
  jsonSchema: JSON.stringify(z.toJSONSchema(responseBlockSchema)),
};

export interface ResponseBlockHTTPResult extends BlockOutput {
  output?: {
    httpCode: string;
    body: unknown;
  };
}

/** terminal — nothing after a response block runs */
export function emitResponse(node: EmitNode) {
  const { httpCode } = responseBlockSchema.parse(node.block.data);
  return node.complete(
    `{ successful: true, continueIfFail: true, output: { httpCode: ${JSON.stringify(httpCode)}, body: ${node.in} ?? null } }`,
  );
}

/**
 * The same block on a workflow canvas: terminal, and nothing else.
 *
 * A workflow is queued and runs with nobody attached, so there is no reply to
 * put a status code on. The configured `httpCode` is deliberately not read —
 * emitting it would produce a field no caller can ever see, and reading the
 * block's data would make a workflow fail to compile over a setting that
 * cannot matter to it.
 */
export function emitWorkflowEnd(node: EmitNode) {
	return node.complete(
		`{ successful: true, continueIfFail: true, output: ${node.in} ?? null }`,
	);
}

export class ResponseBlock extends BaseBlock {
  override async executeAsync(params?: any): Promise<ResponseBlockHTTPResult> {
    const { httpCode } = this.input as z.infer<typeof responseBlockSchema>;
    return {
      continueIfFail: true,
      successful: true,
      output: {
        httpCode,
        body: params ?? null,
      },
    };
  }
}

import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { httpcodes } from "@fluxify/lib";
import type { EmitNode } from "../compiler";

export const responseBlockSchema = z
  .object({
    httpCode: z.string().refine((x) => httpcodes.some((y) => y.code == x)),
    /** opt-in: run `transformScript` on the body before it is sent */
    transformEnabled: z.boolean().optional(),
    transformScript: z.string().optional(),
  })
  .extend(baseBlockDataSchema.shape);

export const responseAiDescription = {
  name: BlockTypes.response,
  description:
    "Terminates the request and returns the result to the client. Sets the status code; the body is whatever the previous block output. Set transformEnabled + transformScript to reshape the body here (the script gets the body as `input` and its return value is sent), instead of adding a separate JS block.",
  jsonSchema: JSON.stringify(z.toJSONSchema(responseBlockSchema)),
};

/** terminal — nothing after a response block runs */
export function emitResponse(node: EmitNode) {
  const { httpCode, transformEnabled, transformScript } =
    responseBlockSchema.parse(node.block.data);
  const body =
    transformEnabled && transformScript?.trim()
      ? node.js(transformScript, node.in)
      : node.in;
  return node.complete(
    `{ successful: true, continueIfFail: true, output: { httpCode: ${JSON.stringify(httpCode)}, body: ${body} ?? null } }`,
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

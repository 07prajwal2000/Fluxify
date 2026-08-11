import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";
import { logger } from "@fluxify/common";
import type { EmitNode } from "../../compiler";

/**
 * Shared by the interpreted block and the compiled `lib.log(...)` call.
 * `message` is whatever the block resolved to — the compiled path hands over an
 * already-evaluated value, so `formatMessage`'s js branch simply does not fire.
 */
export async function runConsoleLog(
  context: Context,
  level: "info" | "warn" | "error",
  message: any,
  params: any,
) {
  const msg = await formatMessage(message, level, context, params);
  if (level == "info") {
    logger.info(msg, "BLOCKS.console");
  } else if (level == "error") {
    logger.error(msg, "BLOCKS.console");
  } else {
    logger.warn(msg, "BLOCKS.console");
  }
}

/** the configured message wins over the flowing value, exactly as the block does */
export function emitLogMessage(
  message: string | undefined,
  node: EmitNode,
) {
  return message?.trim() ? node.value(message) : node.in;
}

export function emitConsoleLog(node: EmitNode) {
  const { level, message } = logBlockSchema.parse(node.block.data);
  return `await lib.log(ctx, ${JSON.stringify(level)}, ${emitLogMessage(message, node)}, ${node.in});\n${node.next()}`;
}

export const consoleAiDescription = {
  name: BlockTypes.consolelog,
  description:
    "Logs a message to the system console.",
  jsonSchema: JSON.stringify(z.toJSONSchema(logBlockSchema)),
};

export class ConsoleLoggerBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof logBlockSchema>,
    next?: string,
  ) {
    super(context, input, next);
  }

  override async executeAsync(params: any): Promise<BlockOutput> {
    const data = this.input as z.infer<typeof logBlockSchema>;
    await runConsoleLog(
      this.context,
      data.level,
      data.message?.trim() != "" ? data.message : params,
      params,
    );
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: params,
    };
  }
}

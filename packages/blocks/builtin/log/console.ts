import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";
import { logger } from "@fluxify/common";
import type { EmitNode } from "../../compiler";

/** shared by the interpreted block and the compiled `lib.log(...)` call */
export async function runConsoleLog(
  context: Context,
  data: z.infer<typeof logBlockSchema>,
  params: any,
) {
  const level = data.level;
  const msgOrParams = data.message?.trim() != "" ? data.message : params;
  const msg = await formatMessage(msgOrParams, level, context, params);
  if (level == "info") {
    logger.info(msg, "BLOCKS.console");
  } else if (level == "error") {
    logger.error(msg, "BLOCKS.console");
  } else {
    logger.warn(msg, "BLOCKS.console");
  }
}

export function emitConsoleLog(node: EmitNode) {
  const data = logBlockSchema.parse(node.block.data);
  return `await lib.log(ctx, ${JSON.stringify(data)}, ${node.in});\n${node.next()}`;
}

export const consoleAiDescription = {
  name: "console_log",
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
    await runConsoleLog(
      this.context,
      this.input as z.infer<typeof logBlockSchema>,
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

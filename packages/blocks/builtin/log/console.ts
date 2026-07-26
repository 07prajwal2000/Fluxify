import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";
import { logger } from "@fluxify/common";

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
    const data = this.input as z.infer<typeof logBlockSchema>;
    const level = data.level;
    const msgOrParams = data.message?.trim() != "" ? data.message : params;
    const msg = await formatMessage(msgOrParams, level, this.context, params);
    if (level == "info") {
      logger.info(msg, "BLOCKS.console");
    } else if (level == "error") {
      logger.error(msg, "BLOCKS.console");
    } else {
      logger.warn(msg, "BLOCKS.console");
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: params,
    };
  }
}

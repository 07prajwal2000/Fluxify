import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";

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
      console.log(msg);
    } else if (level == "error") {
      console.error(msg);
    } else {
      console.warn(msg);
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: params,
    };
  }
}

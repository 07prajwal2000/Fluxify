import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { logBlockSchema } from ".";

export const consoleAiDescription = {
  name: "console_log",
  description: `logs message to console`,
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
    const msg = await this.formatMessage(msgOrParams, level, params);
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

  private async formatMessage(originalMsg: any, level: string, params?: any) {
    const isObject = typeof originalMsg == "object";
    const datetime = new Date().toISOString().split("T");
    const date = datetime[0];
    const time = datetime[1].substring(0, datetime[1].lastIndexOf("."));
    const path = this.context.route;
    const msg = `${level.toUpperCase()}-${path}-${date} ${time}\n${
      isObject
        ? JSON.stringify(originalMsg, null, 2)
        : typeof originalMsg == "string"
          ? originalMsg.startsWith("js:")
            ? ((await this.context.vm.runAsync(
                originalMsg.slice(3),
                params,
              )) as string)
            : originalMsg
          : originalMsg
    }`;
    return msg;
  }
}

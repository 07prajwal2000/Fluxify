import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";
import { AbstractLogger } from "@fluxify/lib";

export const cloudLogsBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
  })
  .extend(logBlockSchema.shape);

export class CloudLogsBlock extends BaseBlock {
  constructor(
    context: Context,
    private readonly logger: AbstractLogger,
    input: z.infer<typeof logBlockSchema>,
    next?: string,
  ) {
    super(context, input, next);
  }

  override async executeAsync(params: any): Promise<BlockOutput> {
    const data = this.input as z.infer<typeof logBlockSchema>;
    const level = data.level;
    const msgOrParams = data.message?.trim() != "" ? data.message : params;
    const msg = await formatMessage(
      msgOrParams,
      level,
      this.context,
      params,
      "obj",
    );

    if (level == "info") {
      this.logger.logInfo(msg);
    } else if (level == "error") {
      this.logger.logError(msg);
    } else {
      this.logger.logWarn(msg);
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: params,
    };
  }
}

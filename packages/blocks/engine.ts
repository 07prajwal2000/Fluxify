import { BaseBlock, BlockOutput, Context } from "./baseBlock";
import { ErrorHandlerBlock } from "./builtin/errorHandler";

type Blocks = {
  [id: string]: BaseBlock;
};

export type EngineOptions = {
  errorHandlerId: string;
  maxExecutionTimeInMs?: number;
  context: Context;
};

export class Engine {
  constructor(private readonly blocks: Blocks, private readonly options: EngineOptions) {}
  public async start(
    blockId: string,
    params?: any
  ): Promise<BlockOutput | null> {
    let result: BlockOutput | null = null;
    const blocks = this.blocks;
    if (!(blockId in blocks)) throw new Error("Block not found");

    const errorBlock = blocks[this.options.errorHandlerId] as ErrorHandlerBlock;
    let block = blocks[blockId],
      nextParams = params;
    if (this.options.context.stopper.timeoutEnd === 0) {
      this.options.context.stopper.timeoutEnd = performance.now() + this.options.context.stopper.duration;
    }
    while (!this.options.context.abortController.signal.aborted && performance.now() < this.options.context.stopper.timeoutEnd) {
      try {
        result = await block.executeAsync(nextParams);
        if (!result || (!result.successful && !result.continueIfFail)) {
          const errorBlockResult = await errorBlock.executeAsync(result.error);
          if (errorBlockResult.next) {
            nextParams = errorBlockResult.output;
            block = blocks[errorBlockResult.next];
            continue;
          } else {
            break;
          }
        }
        nextParams = await result.output;
        if (!result.next) break;
        block = blocks[result.next];
      } catch (error: any) {
        const errorBlockResult = await errorBlock.executeAsync(error);
        if (errorBlockResult.next) {
          nextParams = errorBlockResult.output;
          block = blocks[errorBlockResult.next];
          continue;
        } else {
          return {
            continueIfFail: false,
            successful: false,
            error,
          };
        }
      }
    }
    const stopTime = performance.now() - 200; // subtracting error time
    if (stopTime > this.options.context.stopper.duration) {
      this.options.context.abortController.abort();
      return {
        continueIfFail: false,
        successful: false,
        error: "Timeout exceeded",
      };
    }
    return result;
  }
}

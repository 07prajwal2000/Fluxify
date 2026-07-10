import { BaseBlock, BlockOutput, Context } from "./baseBlock";
import { ErrorHandlerBlock } from "./builtin/errorHandler";
import { ExecutionTimeoutError } from "./errors/timeout";

type Blocks = {
  [id: string]: BaseBlock;
};

export type EngineOptions = {
  errorHandlerId: string;
  maxExecutionTimeInMs?: number;
  context: Context;
};

export class Engine {
  constructor(
    private readonly blocks: Blocks,
    private readonly options: EngineOptions,
  ) {}

  private get stopper() {
    return this.options.context.stopper;
  }

  private get timedOut(): boolean {
    return performance.now() >= this.stopper.timeoutEnd;
  }

  public async start(
    blockId: string,
    params?: any,
  ): Promise<BlockOutput | null> {
    const blocks = this.blocks;

    if (!(blockId in blocks)) {
      throw new Error(`Block not found: ${blockId}`);
    }

    // Initialize timeout end on first start
    if (this.stopper.timeoutEnd === 0) {
      this.stopper.timeoutEnd = performance.now() + this.stopper.duration;
    }

    const errorBlock = blocks[this.options.errorHandlerId] as ErrorHandlerBlock;
    let block = blocks[blockId];
    let nextParams = params;
    let result: BlockOutput | null = null;

    while (!this.timedOut) {
      try {
        result = await block.executeAsync(nextParams);

        if (!result) break;

        if (!result.successful && !result.continueIfFail) {
          if (!errorBlock) {
            return result;
          }
          const errorBlockResult = await errorBlock.executeAsync(result.error);
          if (errorBlockResult?.next) {
            nextParams = errorBlockResult.error;
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
        if (error instanceof ExecutionTimeoutError) {
          return {
            continueIfFail: false,
            successful: false,
            error: error.message,
          };
        }
        if (!errorBlock) {
          return {
            continueIfFail: false,
            successful: false,
            error,
          };
        }
        const errorBlockResult = await errorBlock.executeAsync(error);
        if (errorBlockResult?.next) {
          nextParams = errorBlockResult.error;
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
    // adding 20ms error buffer to timeout
    this.stopper.timeoutEnd += 20;
    if (this.timedOut) {
      return {
        continueIfFail: false,
        successful: false,
        error: "Execution timeout exceeded",
      };
    }

    return result;
  }
}

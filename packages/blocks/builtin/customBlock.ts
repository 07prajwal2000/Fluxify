import { BaseBlock, BlockOptions, BlockOutput, Context } from "../baseBlock";
import { Engine } from "../engine";

export class CustomBlock extends BaseBlock {
	constructor(
		context: Context,
		input: any,
		protected readonly subEngine: Engine,
		protected readonly entrypointId: string,
		next?: string,
	) {
		super(context, input, next);
	}

	override async executeAsync(
		params?: any,
		options?: BlockOptions,
	): Promise<BlockOutput> {
		const evaluatedInput = await this.evaluateInput(this.input, params);
		const mergedParams = {
			...evaluatedInput,
			input: params
		};
		const result = await this.subEngine.start(this.entrypointId, mergedParams);

		// If successful or if an error was successfully handled internally,
		// continueIfFail will determine next steps, otherwise we propagate error.
		return {
			continueIfFail: result?.continueIfFail ?? false,
			successful: result?.successful ?? true,
			next: result?.next ? result.next : this.next,
			output: result?.output,
			error: result?.error,
		};
	}

	private async evaluateInput(input: any, params: any) {
		if (!input || typeof input !== "object") return input;
		const evaluated: any = {};
		for (const key in input) {
			const val = input[key];
			if (typeof val === "string" && val.startsWith("js:")) {
				evaluated[key] = await this.context.vm.runAsync(val.slice(3), params);
			} else {
				evaluated[key] = val;
			}
		}
		return evaluated;
	}
}

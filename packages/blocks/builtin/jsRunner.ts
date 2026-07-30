import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";
import type { EmitNode } from "../compiler";

export const jsRunnerBlockSchema = z
	.object({
		value: z.string(),
	})
	.extend(baseBlockDataSchema.shape);

export const jsRunnerAiDescription = {
	name: "js_runner",
	description: "Executes JavaScript code within an isolated function scope.",
	jsonSchema: JSON.stringify(z.toJSONSchema(jsRunnerBlockSchema)),
};

/**
 * ponytail: user code still goes through the sandbox VM — inlining it into the
 * compiled function is the next iteration, and needs an isolation story first.
 */
export function emitJsRunner(node: EmitNode) {
	const { value } = jsRunnerBlockSchema.parse(node.block.data);
	return `${node.in} = await ctx.vm.runAsync(${JSON.stringify(value)}, ${node.in});\n${node.next()}`;
}

export class JsRunnerBlock extends BaseBlock {
	override async executeAsync(params?: any): Promise<BlockOutput> {
		try {
			const result = await this.context.vm.runAsync(this.input.value, params);
			return {
				continueIfFail: true,
				successful: true,
				output: result,
				next: this.next,
			};
		} catch (error) {
			return {
				continueIfFail: false,
				successful: false,
				error: error?.toString(),
				next: this.next,
			};
		}
	}
}

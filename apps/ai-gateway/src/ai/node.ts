import type { ModelFactory, NodeResult } from ".";
import type { WorkflowContext } from "./types";
import {
	type GenerateTextResult,
	type LanguageModelCallOptions,
	type RequestOptions,
	type Prompt,
	type ToolSet,
	Output,
} from "ai";

/**
 * Options accepted by `callModel`. This mirrors the shape of `generateText`'s
 * parameters but keeps the OUTPUT generic so structured-output types flow through.
 */
type CallModelOptions<
	TOOLS extends ToolSet = ToolSet,
	OUTPUT extends Output.Output = Output.Output<string, string>,
> = LanguageModelCallOptions &
	RequestOptions<TOOLS> &
	Prompt & {
		model: Parameters<Awaited<ReturnType<ModelFactory>>>[0]["model"];
		tools?: TOOLS;
		output?: OUTPUT;
		[key: string]: unknown;
	};

export abstract class BaseNode<TParams, TReturnType extends NodeResult> {
	public readonly id: string;
	protected modelFactory: ModelFactory;

	constructor(id: string, modelFactory: ModelFactory) {
		this.id = id;
		this.modelFactory = modelFactory;
	}

	abstract execute(
		params: TParams,
		context: WorkflowContext,
	): Promise<TReturnType>;

	protected async callModel<
		TOOLS extends ToolSet = ToolSet,
		OUTPUT extends Output.Output = Output.Output<string, string>,
	>(
		options: CallModelOptions<TOOLS, OUTPUT>,
		context: WorkflowContext,
	): Promise<GenerateTextResult<TOOLS, any, OUTPUT>> {
		const generate = await this.modelFactory();

		// Auto-inject registered workflow tools if the node doesn't explicitly override them
		if (!options.tools && Object.keys(context.tools).length > 0) {
			options.tools = context.tools as TOOLS;
		}

		// Sanitize messages to remove unsupported properties that cause some providers to fail
		if (options.messages && Array.isArray(options.messages)) {
			options.messages = options.messages.map((msg: any) => {
				if (msg.role === "assistant" && (msg.reasoning_content !== undefined || msg.reasoning !== undefined)) {
					const { reasoning_content, reasoning, ...rest } = msg;
					return rest;
				}
				return msg;
			}) as any;
		}

		// Native Telemetry Interception
		const logTools = (toolResults?: any[]) => {
			if (!toolResults) return;
			for (const tr of toolResults) {
				context.trackToolExecution(tr.toolName, tr.args, tr.result);
			}
		};

		// Inject onStepFinish to progressively track tools
		const originalOnStepFinish = options.onStepFinish as ((event: any) => Promise<void> | void) | undefined;
		options.onStepFinish = async (event: any) => {
			logTools(event.toolResults);
			if (originalOnStepFinish && typeof originalOnStepFinish === 'function') {
				await originalOnStepFinish(event);
			}
		};

		const result = await generate(
			options as Parameters<typeof generate>[0],
		);

		return result as unknown as GenerateTextResult<TOOLS, any, OUTPUT>;
	}
}

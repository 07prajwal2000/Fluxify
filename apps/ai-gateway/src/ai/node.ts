import type { GenerateTextFn, ModelFactory, NodeResult } from ".";
import type { WorkflowContext } from "./types";
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

	protected async callModel(
		options: Parameters<GenerateTextFn>[0],
		context: WorkflowContext,
	) {
		const generate = await this.modelFactory();

		// Auto-inject registered workflow tools if the node doesn't explicitly override them
		if (!options.tools && Object.keys(context.tools).length > 0) {
			options.tools = context.tools;
		}

		const result = await generate(options);

		// Native Telemetry Interception
		const logTools = (toolResults?: any[]) => {
			if (!toolResults) return;
			for (const tr of toolResults) {
				context.trackToolExecution(tr.toolName, tr.args, tr.result);
			}
		};

		// Safely account for both single-step and multi-step (maxSteps) generation loops
		if (result.steps && result.steps.length > 0) {
			result.steps.forEach((step) => logTools(step.toolResults));
		} else {
			logTools(result.toolResults);
		}

		return result;
	}
}

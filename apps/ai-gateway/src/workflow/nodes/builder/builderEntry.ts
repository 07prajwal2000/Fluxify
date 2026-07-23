import { BaseNode } from "../../../ai";
import type {
	NodeResult,
	ModelFactory,
	WorkflowMetadata,
	WorkflowContext,
} from "../../../ai/types";
import type { ModelMessage, LanguageModel } from "ai";
import type { BuilderState } from "./types";

export interface BuilderEntryParams {
	query: string;
	messageHistory?: ModelMessage[];
	metadata: WorkflowMetadata;
	model: LanguageModel;
}

export interface BuilderEntryResult extends NodeResult {
	nextNodeId: "verifyUserQuery";
	query: string;
	messageHistory?: ModelMessage[];
	metadata: WorkflowMetadata;
	model: LanguageModel;
	builderState: BuilderState;
}

/**
 * Thin entry node for the builder sub-graph.
 * Classifier routes here via nextNodeId: "builder".
 * Immediately delegates to the verifyUserQuery node.
 */
export class BuilderEntryNode extends BaseNode<
	BuilderEntryParams,
	BuilderEntryResult
> {
	constructor(modelFactory: ModelFactory) {
		super("builder", modelFactory);
	}

	async execute(
		params: BuilderEntryParams,
		_context: WorkflowContext,
	): Promise<BuilderEntryResult> {
		return {
			status: "success",
			nextNodeId: "verifyUserQuery",
			query: params.query,
			messageHistory: params.messageHistory,
			metadata: params.metadata,
			model: params.model,
			builderState: {
				scratchPad: [],
			},
		};
	}
}

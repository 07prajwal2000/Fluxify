import type { BaseNode } from ".";
import type {
	NodeExecutionRecord,
	ToolExecutionRecord,
	NodeSuccessCallback,
	NodeFailureCallback,
	ToolExecutionCallback,
	WorkflowMetadata,
	WorkflowContext,
	NodeResult,
} from "./types";

export class Workflow<TNodeRegistry extends Record<string, any>> {
	private nodes = new Map<keyof TNodeRegistry, BaseNode<any, any>>();
	private tools: Record<string, any> = {};

	private nodeExecutionHistory: NodeExecutionRecord[] = [];
	private toolExecutionHistory: ToolExecutionRecord[] = [];

	private handleNodeSuccess?: NodeSuccessCallback;
	private handleNodeFailure?: NodeFailureCallback;
	private handleToolExecution?: ToolExecutionCallback;

	public readonly metadata: WorkflowMetadata;

	constructor(metadata: WorkflowMetadata) {
		this.metadata = metadata;
	}

	public addNode<K extends keyof TNodeRegistry>(
		node: BaseNode<TNodeRegistry[K], any>,
	): this {
		this.nodes.set(node.id as K, node);
		return this;
	}

	// Hook Registration
	public onNodeSuccess(callback: NodeSuccessCallback): this {
		this.handleNodeSuccess = callback;
		return this;
	}
	public onNodeFailure(callback: NodeFailureCallback): this {
		this.handleNodeFailure = callback;
		return this;
	}
	public onToolExecution(callback: ToolExecutionCallback): this {
		this.handleToolExecution = callback;
		return this;
	}

	// Simply accepts the raw output of Vercel's tool() directly
	public registerTool(name: string, toolDefinition: any): this {
		this.tools[name] = toolDefinition;
		return this;
	}

	public getNodeHistory() {
		return [...this.nodeExecutionHistory];
	}
	public getToolHistory() {
		return [...this.toolExecutionHistory];
	}

	public async start<K extends keyof TNodeRegistry>(
		initialNodeId: K,
		initialData: TNodeRegistry[K],
	) {
		return this.runLoop(initialNodeId as string, initialData);
	}

	public async continue<K extends keyof TNodeRegistry>(
		nodeId: K,
		data: TNodeRegistry[K],
	) {
		return this.runLoop(nodeId as string, data);
	}

	private async runLoop(startNodeId: string, startParams: any) {
		let currentNodeId: string | undefined = startNodeId;
		let currentParams = startParams;

		while (currentNodeId) {
			const node = this.nodes.get(currentNodeId);
			if (!node)
				throw new Error(
					`Execution halted: Node '${currentNodeId}' is not registered.`,
				);

			// Generate the runtime execution context for this loop pass
			const context: WorkflowContext = {
				metadata: this.metadata,
				tools: this.tools,
				// The callback injected into the node to bubble up tool telemetry
				trackToolExecution: (toolName, input, output) => {
					this.toolExecutionHistory.push({
						toolName,
						timestamp: new Date(),
						input,
						output,
					});
					if (this.handleToolExecution) {
						this.handleToolExecution(toolName, input, output);
					}
				},
			};

			try {
				const result: NodeResult = await node.execute(currentParams, context);

				this.nodeExecutionHistory.push({
					nodeId: currentNodeId,
					timestamp: new Date(),
					input: currentParams,
					output: result,
					status: "success",
				});

				if (this.handleNodeSuccess)
					await this.handleNodeSuccess(currentNodeId, currentParams, result);
				if (result.status === "failure") return result;

				currentNodeId = result.nextNodeId;
				currentParams = result;
			} catch (error) {
				this.nodeExecutionHistory.push({
					nodeId: currentNodeId!,
					timestamp: new Date(),
					input: currentParams,
					error: error,
					status: "failure",
				});

				if (this.handleNodeFailure)
					await this.handleNodeFailure(currentNodeId!, currentParams, error);
				throw error;
			}
		}
		return currentParams;
	}
}

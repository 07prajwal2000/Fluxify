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
	NodeEnterCallback,
} from "./types";

export class Workflow<TNodeRegistry extends Record<string, any>> {
	private nodes = new Map<keyof TNodeRegistry, BaseNode<any, any>>();
	private tools: Record<string, any> = {};
	private currentNodeId: string | undefined = undefined;

	private nodeExecutionHistory: NodeExecutionRecord[] = [];
	private toolExecutionHistory: ToolExecutionRecord[] = [];

	private handleNodeEnter?: NodeEnterCallback;
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
	public onNodeEnter(callback: NodeEnterCallback): this {
		this.handleNodeEnter = callback;
		return this;
	}
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
	public getCurrentNode() {
		return this.currentNodeId;
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
		this.currentNodeId = startNodeId;
		let currentParams = startParams;

		while (this.currentNodeId) {
			const node = this.nodes.get(this.currentNodeId);
			if (!node)
				throw new Error(
					`Execution halted: Node '${this.currentNodeId}' is not registered.`,
				);

			if (this.handleNodeEnter)
				await this.handleNodeEnter(this.currentNodeId, currentParams);
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

				if (result.status === "failure") {
					const error: any = new Error("failed to execute the node " + this.currentNodeId);
					error.result = result;
					throw error;
				}

				this.nodeExecutionHistory.push({
					nodeId: this.currentNodeId!,
					timestamp: new Date(),
					input: currentParams,
					output: result,
					status: "success",
				});

				if (this.handleNodeSuccess)
					await this.handleNodeSuccess(
						this.currentNodeId,
						currentParams,
						result,
					);

				this.currentNodeId = result.nextNodeId;
				currentParams = result;
			} catch (error) {
				this.nodeExecutionHistory.push({
					nodeId: this.currentNodeId!,
					timestamp: new Date(),
					input: currentParams,
					error: error,
					status: "failure",
				});

				if (this.handleNodeFailure)
					await this.handleNodeFailure(
						this.currentNodeId!,
						currentParams,
						error,
					);
				throw error;
			}
		}
		return currentParams;
	}
}

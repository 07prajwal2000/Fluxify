import { ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredTool } from "@langchain/core/tools";
import { summarizeToolResult } from "./jsonUtils";
import type { NormalizedToolCall } from "./toolLoop";

type ToolEvent = {
	agent?: string;
	agentId?: string;
	tool: string;
	status: "started" | "ended";
	summary?: string;
	error?: string;
};

type ToolExecutionContext = {
	agent?: string;
	agentId?: string;
	config?: RunnableConfig;
	withSignal: (config?: RunnableConfig) => RunnableConfig;
	emitToolEvent: (data: ToolEvent) => Promise<void>;
};

/** Runs one tool call and produces the corresponding provider-valid result. */
export async function executeToolCall(
	tc: NormalizedToolCall,
	tools: StructuredTool[],
	ctx: ToolExecutionContext,
): Promise<ToolMessage> {
	const tool = tools.find((candidate) => candidate.name === tc.name);
	const toolEvent = { agent: ctx.agent, agentId: ctx.agentId, tool: tc.name };
	await ctx.emitToolEvent({ ...toolEvent, status: "started" });

	if (!tool) {
		await ctx.emitToolEvent({
			...toolEvent,
			status: "ended",
			error: `tool ${tc.name} not found`,
		});
		return new ToolMessage({
			tool_call_id: tc.id,
			content: `Tool ${tc.name} not found.`,
			name: tc.name,
		});
	}

	try {
		const toolResult = await tool.invoke(tc.args, ctx.withSignal(ctx.config));
		await ctx.emitToolEvent({
			...toolEvent,
			status: "ended",
			summary: summarizeToolResult(toolResult),
		});
		return new ToolMessage({
			tool_call_id: tc.id,
			content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
			name: tc.name,
		});
	} catch (error) {
		await ctx.emitToolEvent({
			...toolEvent,
			status: "ended",
			error: error instanceof Error ? error.message : String(error),
		});
		return new ToolMessage({
			tool_call_id: tc.id,
			content: `Error executing tool ${tc.name}: ${error}`,
			name: tc.name,
		});
	}
}

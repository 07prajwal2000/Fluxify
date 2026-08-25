import { ToolMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredTool } from "@langchain/core/tools";
import { summarizeToolResult } from "./jsonUtils";
import type { NormalizedToolCall } from "./toolLoop";

/** These tools only read immutable-for-the-run data. Replaying a result for an
 * identical call avoids another DB/vector-store round trip without changing
 * agent-visible behaviour. Keep mutations out of this list. */
const MEMOIZED_READ_TOOLS = new Set([
	"search_docs",
	"find_resource",
	"get_route_details",
	"get_custom_block_schemas",
	"get_agent_output",
	"get_artifact",
]);

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

/** Message arrays are allocated once per agent invocation and discarded when it
 * completes, making them a natural key for invocation-scoped read caches. */
const readToolCaches = new WeakMap<object, Map<string, Promise<ToolMessage>>>();

function readToolCacheFor(scope: object): Map<string, Promise<ToolMessage>> {
	const existing = readToolCaches.get(scope);
	if (existing) return existing;
	const cache = new Map<string, Promise<ToolMessage>>();
	readToolCaches.set(scope, cache);
	return cache;
}

function canonicalToolArgs(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalToolArgs).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalToolArgs(item)}`)
		.join(",")}}`;
}

export function memoizedReadToolKey(
	call: NormalizedToolCall,
): string | undefined {
	if (!MEMOIZED_READ_TOOLS.has(call.name)) return undefined;
	return `${call.name}:${canonicalToolArgs(call.args)}`;
}

/** A provider requires a result for each tool-call id, even when the work was
 * already done for an earlier identical call. */
export function replayToolResult(
	call: NormalizedToolCall,
	result: ToolMessage,
): ToolMessage {
	return new ToolMessage({
		tool_call_id: call.id,
		name: call.name,
		content: result.content,
	});
}

export function isFailedToolResult(result: ToolMessage): boolean {
	return typeof result.content === "string" &&
		(result.content.startsWith("Error executing tool") ||
			result.content.startsWith("Tool ") && result.content.endsWith(" not found."));
}

/** Executes a read-only tool once per invocation and replays its result for
 * equivalent later calls. The caller supplies execution because only the
 * wrapper owns model/run context and telemetry. */
export function executeMemoizedReadTool(
	call: NormalizedToolCall,
	cache: Map<string, Promise<ToolMessage>>,
	execute: () => Promise<ToolMessage>,
): Promise<ToolMessage> {
	const cacheKey = memoizedReadToolKey(call);
	if (!cacheKey) return execute();

	const cached = cache.get(cacheKey);
	if (cached) return cached.then((result) => replayToolResult(call, result));

	const result = execute().then((toolResult) => {
		// A transient failure should be retryable on a later model turn.
		if (isFailedToolResult(toolResult)) cache.delete(cacheKey);
		return toolResult;
	});
	cache.set(cacheKey, result);
	return result;
}

/** Executes a model-requested tool batch in call order. A submitted answer can
 * be replaced with corrective feedback while every other read call remains
 * memoized for this agent invocation. */
export function executeToolBatch(
	calls: NormalizedToolCall[],
	scope: object,
	reject: (call: NormalizedToolCall) => ToolMessage | undefined,
	execute: (call: NormalizedToolCall) => Promise<ToolMessage>,
): Promise<ToolMessage[]> {
	const cache = readToolCacheFor(scope);
	return Promise.all(
		calls.map((call) =>
			reject(call) ??
			executeMemoizedReadTool(call, cache, () => execute(call)),
		),
	);
}

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

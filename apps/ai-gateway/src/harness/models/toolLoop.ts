import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { StructuredTool, tool } from "@langchain/core/tools";
import { logger } from "@fluxify/common";
import { z } from "zod";
import {
	summarizeToolResult,
	parseJsonLoose,
	extractText,
	cleanJsonOutput,
} from "./jsonUtils";

/** Message plumbing for the tool-execution loop in `base.ts`. */

/** Tool results older than this many tool turns are replaced with a one-line
 *  summary. The whole history is re-sent every iteration, so without this the
 *  first tool result is billed once per remaining turn. */
const VERBATIM_TOOL_RESULTS = 2;

/**
 * Replaces all but the most recent tool results with a one-line summary, in
 * place. The full history is re-sent on every tool iteration, so a fat result
 * from turn 1 is otherwise billed again on turns 2..n — the single biggest
 * source of token growth in a multi-tool run.
 *
 * The last {@link VERBATIM_TOOL_RESULTS} stay intact because those are what the
 * model is reasoning over right now. Older ones only need to record that the
 * call happened and roughly what came back. Compacted messages are marked so a
 * second pass doesn't summarise a summary.
 */
export function compactToolHistory(messages: BaseMessage[]): void {
	const toolIndexes: number[] = [];
	messages.forEach((m, i) => {
		if (m instanceof ToolMessage) toolIndexes.push(i);
	});

	for (const i of toolIndexes.slice(0, -VERBATIM_TOOL_RESULTS)) {
		const msg = messages[i] as ToolMessage;
		if (msg.additional_kwargs?.compacted) continue;
		const text = typeof msg.content === "string" ? msg.content : "";
		messages[i] = new ToolMessage({
			tool_call_id: msg.tool_call_id,
			name: msg.name,
			// summarizeToolResult only understands JSON; markdown tables and prose
			// fall back to a head slice.
			content: `[earlier result from ${msg.name ?? "tool"}, condensed] ${
				summarizeToolResult(text) ??
				(text.length > 300 ? `${text.slice(0, 300)}…` : text)
			}`,
			additional_kwargs: { ...msg.additional_kwargs, compacted: true },
		});
	}
}

/** Tool the model calls to deliver its final structured answer. */
export const SUBMIT_RESULT_TOOL = "submit_result";

export const SUBMIT_RESULT_INSTRUCTION = `When you have everything you need, deliver your final answer by calling the \`${SUBMIT_RESULT_TOOL}\` tool — its arguments are the answer. Do not write the answer out as text as well; that costs a full extra generation and is discarded.`;

/**
 * Exposes the caller's output schema as a tool, so a tool-using agent can hand
 * back its answer inside the same loop it is already in.
 *
 * Without this the model writes its answer as free text, that message is thrown
 * away, and the *identical* content is regenerated as JSON by a second call —
 * for the block builder that is 1000+ output tokens produced twice.
 *
 * Returns undefined for non-object schemas (tool arguments are always an object
 * shape); the caller then keeps the old two-call path.
 */
export function makeSubmitResultTool(
	schema: z.ZodType<any>,
): StructuredTool | undefined {
	if (!(schema instanceof z.ZodObject)) return undefined;
	// The implementation is never reached — the tool loop intercepts the call by
	// name and returns its arguments as the result.
	return tool(async () => "", {
		name: SUBMIT_RESULT_TOOL,
		description:
			"Submit your final answer. Call this exactly once, when you have gathered everything you need. The arguments are the complete result.",
		schema,
	}) as unknown as StructuredTool;
}

/** Parses free text against the schema, or undefined if it isn't a match. */
export function parseAsSchema<T>(
	schema: z.ZodType<any>,
	text: string,
): T | undefined {
	if (!text.trim()) return undefined;
	try {
		return schema.parse(parseJsonLoose(cleanJsonOutput(text))) as T;
	} catch {
		return undefined;
	}
}

/**
 * Every tool call on a message, wherever the provider put it.
 *
 * Two traps, and a message can spring either:
 *
 * 1. `AIMessageChunk` **implements** `AIMessage` but extends `BaseMessageChunk`,
 *    so `instanceof AIMessage` is false for a streamed reply. Gate on the
 *    message type instead — both report `"ai"`.
 * 2. OpenAI-compatible providers (DeepSeek among them) report the call in
 *    `additional_kwargs.tool_calls` and may leave `tool_calls` empty.
 *
 * Miss either and an assistant message reaches the unbound structured-output
 * call still carrying tool calls that no ToolMessage answers — a 400
 * ("insufficient tool messages following tool_calls message") on every attempt,
 * spending the whole retry budget on the history rather than on the answer.
 */
export function toolCallsOf(message: unknown): unknown[] {
	const m = message as
		| {
				getType?: () => string;
				tool_calls?: unknown;
				additional_kwargs?: Record<string, any>;
		  }
		| undefined;
	if (m?.getType?.() !== "ai") return [];
	return [
		...(Array.isArray(m.tool_calls) ? m.tool_calls : []),
		...(Array.isArray(m.additional_kwargs?.tool_calls)
			? m.additional_kwargs.tool_calls
			: []),
	];
}

/**
 * Collapses tool traffic into plain turns, ending on a human message.
 *
 * The structured-output fallback invokes the *unbound* model. Anthropic and
 * Mistral reject a request that carries `tool_use` blocks when no tools are
 * declared, so the raw loop history cannot be handed to it. OpenAI tolerates
 * it, which is why this went unnoticed.
 */
export function flattenToolMessages(messages: BaseMessage[]): BaseMessage[] {
	const out: BaseMessage[] = [];
	const findings: string[] = [];

	for (const m of messages) {
		if (m instanceof ToolMessage) {
			findings.push(
				`${m.name ?? "tool"}: ${
					typeof m.content === "string" ? m.content : JSON.stringify(m.content)
				}`,
			);
			continue;
		}
		if (toolCallsOf(m).length > 0) {
			// Keep any reasoning it wrote alongside the call, drop the call itself.
			// A fresh AIMessage carries no `additional_kwargs`, so both copies go.
			const text = extractText(m);
			if (text.trim()) out.push(new AIMessage(text));
			continue;
		}
		out.push(m);
	}

	if (findings.length > 0) {
		out.push(
			new HumanMessage(
				`Results of the tools you called:\n\n${findings.join("\n\n")}`,
			),
		);
	}
	return out;
}

/**
 * Logs what a call is about to send, per message. Off unless
 * HARNESS_DEBUG_PROMPT=1 — a run's prompt growth is invisible otherwise, and
 * "the block builder is slow" is usually "its history grew to six figures".
 */
export function debugPrompt(
	agentNode: string | undefined,
	messages: BaseMessage[],
): void {
	if (process.env.HARNESS_DEBUG_PROMPT !== "1") return;
	const size = (m: BaseMessage) =>
		JSON.stringify(m.content).length +
		JSON.stringify(m.additional_kwargs ?? {}).length;
	logger.info("[Harness] prompt", {
		agent: agentNode,
		messages: messages.length,
		chars: messages.reduce((sum, m) => sum + size(m), 0),
		breakdown: messages.map((m) => `${m.getType()}:${size(m)}`).join(" "),
	});
}

/**
 * Feeds the model's own message back into the correction turn, rather than a
 * fresh AIMessage built from the cleaned text. Reasoning models carry their
 * thinking in content blocks or `additional_kwargs.reasoning_content`, and
 * dropping it makes attempt 2 re-derive (and re-botch) the same answer.
 */
export function asHistoryMessage(response: unknown, cleaned: string): AIMessage {
	const raw = response as
		| { content?: unknown; additional_kwargs?: Record<string, any> }
		| undefined;
	if (!raw) return new AIMessage(cleaned || "(empty response)");

	const hasContent =
		typeof raw.content === "string"
			? raw.content.trim() !== ""
			: Array.isArray(raw.content) && raw.content.length > 0;

	// A tool call must never ride into the correction turn. The next thing we
	// append is a HumanMessage, and an assistant message carrying `tool_calls`
	// with no ToolMessage answering it is rejected outright ("insufficient tool
	// messages following tool_calls message") — so every remaining attempt 400s
	// on the history instead of on the answer. This model is unbound; it has no
	// tools to call here anyway.
	const { tool_calls: _tc, ...kwargs } = raw.additional_kwargs ?? {};
	const hasToolCalls = toolCallsOf(response).length > 0;

	if (hasContent && response instanceof AIMessage && !hasToolCalls)
		return response;

	return new AIMessage({
		content: hasContent
			? (raw.content as any)
			: extractText(raw as any) ||
				(hasToolCalls
					? "(attempted a tool call — no tools are available at this step)"
					: "(empty response)"),
		additional_kwargs: kwargs,
	});
}

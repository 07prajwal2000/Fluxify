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
		if (m instanceof AIMessage && m.tool_calls?.length) {
			// Keep any reasoning it wrote alongside the call, drop the call itself.
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

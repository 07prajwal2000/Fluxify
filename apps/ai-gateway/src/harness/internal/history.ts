import type { BaseMessage } from "@langchain/core/messages";

/**
 * Conversation history is prefixed onto the router, planner and discussion
 * prompts on every run. `aiResponse` is whatever the run finalized with —
 * routinely an entire markdown plan of 1-3K tokens — so five runs of unbounded
 * history is 4-8K tokens of prefix before the agent has read a word of the
 * actual request.
 *
 * The full text is never lost: it stays on the run row and the agents can pull
 * it back deliberately with `get_artifact`.
 */

/** Per-message ceiling. ~375 tokens — enough for a summary, not a whole plan. */
export const HISTORY_MESSAGE_BUDGET = 1500;

/** Ceiling for the whole history block. ~1.5K tokens. */
export const HISTORY_TOTAL_BUDGET = 6000;

const ELLIPSIS = "\n\n…[trimmed]…\n\n";

/** Keeps the head and tail of a long message — an answer's opening and its
 *  conclusion carry the context; the middle is the body of the plan. */
export function truncateMiddle(
	text: string,
	budget: number = HISTORY_MESSAGE_BUDGET,
): string {
	if (text.length <= budget) return text;
	const keep = Math.floor((budget - ELLIPSIS.length) / 2);
	return text.slice(0, keep) + ELLIPSIS + text.slice(-keep);
}

/**
 * Drops whole turns from the front until the history fits the budget. Oldest
 * first — the most recent exchange is the one that actually informs the next
 * classification.
 */
export function capHistory(
	messages: BaseMessage[],
	budget: number = HISTORY_TOTAL_BUDGET,
): BaseMessage[] {
	const size = (m: BaseMessage) =>
		typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length;

	let total = messages.reduce((sum, m) => sum + size(m), 0);
	let start = 0;
	while (total > budget && start < messages.length) {
		total -= size(messages[start]!);
		start++;
	}
	return messages.slice(start);
}

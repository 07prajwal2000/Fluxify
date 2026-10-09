import type { ModelMessage } from "ai";

/** A request without the budget line the agent adds at its end, for tests about the conversation itself. */
export const withoutBudget = (prompt: ModelMessage[]) =>
	JSON.stringify(prompt.at(-1)).includes('"Budget: step ') ? prompt.slice(0, -1) : prompt;

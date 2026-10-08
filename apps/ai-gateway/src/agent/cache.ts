import type { LanguageModel, ModelMessage, SystemModelMessage } from "ai";

const ephemeral = { anthropic: { cacheControl: { type: "ephemeral" } } };

/**
 * Anthropic only (the others cache by themselves, on a stable prefix): a cache
 * breakpoint on the system prompt and on the last message. The last one moves
 * forward each step, so the older ones are cleared first (max 4 breakpoints,
 * and a `messages` override carries into the next step).
 */
export function anthropicCache(
	model: Exclude<LanguageModel, string>,
	instructions: string,
	messages: ModelMessage[],
) {
	if (!model.provider.startsWith("anthropic")) return {};
	const system: SystemModelMessage = {
		role: "system",
		content: instructions,
		providerOptions: ephemeral,
	};
	const marked = messages.map(({ providerOptions: _, ...m }, i) =>
		i === messages.length - 1 ? { ...m, providerOptions: ephemeral } : m,
	) as ModelMessage[];
	return { instructions: system, messages: marked };
}

/** Cache tokens of one step (or a run total) that the provider reported. */
export const cacheTokens = (u?: {
	inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
}) => ({
	read: u?.inputTokenDetails?.cacheReadTokens ?? 0,
	write: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
});

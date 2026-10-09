/**
 * The slash commands of the chat editor. To add one: list it here, and give it
 * a handler in `useAgentConversation` (its `slash` map is typed by `SlashName`,
 * so a missing handler does not compile).
 */
export const SLASH_COMMANDS = [
	{
		name: "compact",
		hint: "[what to keep]",
		description: "Summarize the conversation so far. Add text to say what the summary must keep.",
	},
] as const;

export type SlashName = (typeof SLASH_COMMANDS)[number]["name"];
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

/** Commands to suggest for what is typed: only while the text is a lone `/` and part of a name. */
export const slashSuggestions = (text: string): readonly SlashCommand[] => {
	const typed = /^\/([a-z]*)$/i.exec(text)?.[1];
	if (typed === undefined) return [];
	return SLASH_COMMANDS.filter((c) => c.name.startsWith(typed.toLowerCase()));
};

/** `/compact keep the ids` → the command and its text; undefined when the message is not a known command. */
export function parseSlash(text: string): { command: SlashCommand; args: string } | undefined {
	const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
	const command = SLASH_COMMANDS.find((c) => c.name === m?.[1].toLowerCase());
	return command && m ? { command, args: (m[2] ?? "").trim() } : undefined;
}

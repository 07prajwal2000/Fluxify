// The "model" is a script, not an LLM, so a test or an e2e run answers the same
// every time. Swap `fakeModel` for a call to a real provider and nothing else changes.

/** what a tool block hands the agent */
export type Tool = {
	name: string;
	description: string;
	/** JSON Schema of the arguments, for the model */
	schema: unknown;
	/** runs the chain wired to the tool block */
	call: (args: unknown) => Promise<unknown>;
};

export type ToolCall = { tool: string; args: { text: string } };

export const isTool = (value: unknown): value is Tool =>
	typeof (value as Tool | null)?.call === "function" && typeof (value as Tool).name === "string";

/** asks for every tool whose name is a word of the prompt, in the order the tools are wired */
export function fakeModel(prompt: string, tools: Tool[]): ToolCall[] {
	const words = new Set(prompt.toLowerCase().match(/[a-z0-9_-]+/g));
	return tools
		.filter((t) => words.has(t.name.toLowerCase()))
		.map((t) => ({ tool: t.name, args: { text: prompt } }));
}

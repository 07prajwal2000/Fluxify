import { block, handle, param } from "@fluxify/sdk/blocks";
import { fakeModel, isTool, type Tool } from "../model";

export default block({
	name: "fluxify-examples/agent-tools/agent",
	label: "Agent",
	description: "Lets a scripted model call the Tool blocks wired to it.",
	shape: "wide",
	docs: `Answers a prompt by calling the tools wired to it. It uses a scripted model, so the same prompt always makes the same calls.

## When to use it
Wire one or more **Tool** blocks to the **Tools** handle. The agent calls the tools the model asks for and returns what they gave back.

## Inputs
| Name | Required | Default |
| :--- | :--- | :--- |
| Prompt | Yes | |
| Max tool calls | No | 5 |

## Outputs
| Handle | When |
| :--- | :--- |
| \`success\` | The agent finished. The output holds \`answer\` and \`calls\`, one entry per tool call. |
| \`failure\` | The agent itself failed. The output is the error message. |

A tool whose chain throws does not fail the agent: its entry in \`calls\` holds an \`error\` instead of a \`result\`.`,
	invoke: ["sync"],
	params: {
		prompt: param.string({ label: "Prompt", required: true }),
		maxCalls: param.number({ label: "Max tool calls", default: 5, min: 1, integer: true }),
	},
	handles: {
		out: [handle.out("success"), handle.out("failure")],
		body: [handle.body("tools", "bottom-left", { allowMultiple: true })],
	},
	async run({ params, ctx, executeHandle }) {
		// every Tool block wired to `tools`, in parallel; a branch that failed is `{ error }`
		const tools: Tool[] = [];
		for (const found of await executeHandle("tools")) {
			if (isTool(found)) tools.push(found);
			else ctx.vars.logger.logWarn(`a tool block failed and was skipped: ${JSON.stringify(found)}`);
		}

		const calls = [];
		for (const { tool, args } of fakeModel(params.prompt, tools).slice(0, params.maxCalls)) {
			const target = tools.find((t) => t.name === tool)!;
			try {
				const result = await ctx.span(`tool:${tool}`, () => target.call(args));
				calls.push({ tool, args, result });
			} catch (error) {
				calls.push({ tool, args, error: (error as Error).message });
			}
		}
		const used = calls.map((c) => c.tool);
		return {
			output: { answer: used.length ? `used ${used.join(", ")}` : "no tool needed", calls },
			handle: "success",
		};
	},
});

import { block, handle, param } from "@fluxify/sdk/blocks";

export default block({
	name: "fluxify-examples/agent-tools/tool",
	label: "Tool",
	description: "A tool an Agent block can call. Wire what it does to its Execute handle.",
	shape: "square",
	docs: `Gives an **Agent** block one tool. The chain you wire to **Execute** is what the tool does.

## When to use it
Wire this block to an Agent block's **Tools** handle, then draw the tool's logic from **Execute**. Add one Tool block per tool.

## Inputs
| Name | Required | Default |
| :--- | :--- | :--- |
| Name | Yes | |
| Description | No | |
| Arguments schema | No | One text argument |

## Outputs
This block ends its chain, so it has no output handle. The Agent block receives the tool, and each time it calls the tool the **Execute** chain runs with the arguments as its input. The chain's last value is the tool's result.

::: tip
Name the tool with one word, like \`search\`. The scripted model in this example picks the tools whose name appears in the prompt.
:::`,
	// the output holds a function, which only a sync call can pass on
	invoke: ["sync"],
	params: {
		name: param.string({ label: "Name", required: true }),
		description: param.string({ label: "Description", default: "" }),
		schema: param.json({
			label: "Arguments schema",
			description: "JSON Schema of the arguments the model passes in",
			default: { type: "object", properties: { text: { type: "string" } } },
		}),
	},
	handles: {
		out: [],
		body: [handle.body("execute", "bottom-right")],
	},
	async run({ params, executeHandle }) {
		return {
			output: {
				name: params.name,
				description: params.description,
				schema: params.schema,
				// runs after this `run` returned, while the agent's run is still going
				call: (args: unknown) => executeHandle("execute", args),
			},
		};
	},
});

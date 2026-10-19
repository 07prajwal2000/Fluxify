// A plugin block written with the SDK, imported by `sdkPluginBlock.spec.ts`
// through the real plugin loader.
import { block, handle, param } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/greet/hello",
	label: "Hello",
	invoke: ["sync"],
	params: {
		who: param.string({ required: true }),
		times: param.number({ default: 2 }),
		shape: param.schema(),
	},
	handles: {
		out: [handle.out("success"), handle.out("failure")],
		body: [handle.body("decorate", "top-left")],
	},
	async run({ params, input, ctx, executeHandle }) {
		if (params.shape && !params.shape.zod.safeParse(input).success)
			return { output: "input does not fit the schema", handle: "failure" };
		const name = await ctx.span("decorate", () => executeHandle("decorate", params.who));
		return { output: `hello ${name} x${params.times}`, handle: "success" };
	},
});

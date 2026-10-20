// Type tests for `runBlock`: compiled by `bun run typecheck`, never run.
import { block, handle, param } from "../blocks.js";
import { runBlock } from "../testing.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>() => {};

const post = block({
	name: "acme/slack/post",
	label: "Post",
	invoke: ["sync"],
	params: {
		channel: param.string({ required: true }),
		mode: param.select({ options: ["a", "b"], default: "a" }),
	},
	handles: {
		out: [handle.out("success"), handle.out("failure")],
		body: [handle.body("tools", "bottom-left", { allowMultiple: true }), handle.body("each", "top-left")],
	},
	run: () => ({ handle: "success" }),
});

async function checks() {
	const r = await runBlock(post, {
		params: { channel: "#ops" },
		handles: { tools: [{ label: "search", run: async () => 1 }], each: (i) => i },
	});
	assert<Equal<typeof r.handle, "success" | "failure" | undefined>>();

	// @ts-expect-error `channel` is required
	await runBlock(post, { params: {} });
	// @ts-expect-error a required param means options are required
	await runBlock(post);
	// @ts-expect-error not one of mode's options
	await runBlock(post, { params: { channel: "x", mode: "c" } });
	// @ts-expect-error a number for a string param
	await runBlock(post, { params: { channel: 1 } });
	// @ts-expect-error not a body handle
	await runBlock(post, { params: { channel: "x" }, handles: { success: () => 1 } });
	// @ts-expect-error an allowMultiple handle takes branches, not a function
	await runBlock(post, { params: { channel: "x" }, handles: { tools: () => 1 } });

	// no params, no body handles: options are optional, `handle` is `source`
	const plain = block({ name: "acme/x/plain", label: "P", run: () => ({ output: 1 }) });
	const p = await runBlock(plain);
	assert<Equal<typeof p.handle, "source" | undefined>>();
	// @ts-expect-error no body handles to stub
	await runBlock(plain, { handles: { each: () => 1 } });
}
void checks;

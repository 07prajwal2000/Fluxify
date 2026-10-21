import { expect, it } from "bun:test";
import { runBlock } from "@fluxify/sdk/testing";
import tool from "./tool";

it("hands the agent its name, schema and a way to run the chain", async () => {
	// keepAlive: the agent calls the tool after this run returned, so the run stays open
	const r = await runBlock(tool, {
		params: { name: "search" },
		handles: { execute: (args) => ({ found: args }) },
		keepAlive: true,
	});
	expect(r.error).toBeUndefined();
	// a terminal block: no output handle
	expect(r.handle).toBeUndefined();
	const out = r.output as { name: string; schema: unknown; call: (a: unknown) => Promise<unknown> };
	expect(out.name).toBe("search");
	expect(out.schema).toMatchObject({ type: "object" });
	expect(await out.call({ text: "hi" })).toEqual({ found: { text: "hi" } });
	expect(r.handleCalls).toEqual([
		{ handle: "execute", input: { text: "hi" }, result: { found: { text: "hi" } } },
	]);
	r.end();
});

it("cannot be called once the run is over", async () => {
	const r = await runBlock(tool, {
		params: { name: "search" },
		handles: { execute: () => 1 },
	});
	await expect(r.callAfterEnd("execute")).rejects.toThrow("called after the run ended");
});

it("must be called sync: its output holds a function", async () => {
	await expect(runBlock(tool, { params: { name: "x" }, invoke: "queued" })).rejects.toThrow(
		"cannot be invoked queued",
	);
});

it("needs a name", async () => {
	const r = await runBlock(tool, { params: {} as never });
	expect(r.error?.message).toBe("param 'name' is required");
});

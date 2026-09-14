import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

function withHttpClient() {
	const calls: { url: string; body: unknown; headers: unknown }[] = [];
	const ctx = createContext();
	ctx.httpClient = {
		post: async (url: string, body: unknown, headers: unknown) => {
			calls.push({ url, body, headers });
			return { data: "ok", status: 201 };
		},
	};
	return { ctx, calls };
}

const graph = (data: Record<string, unknown>) =>
	compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.httprequest, { method: "POST", headers: {}, body: "", ...data }),
		],
		[edge("1", "2")],
	);

describe("httprequest block", () => {
	it("compiles js: url, body, header names and values without the vm", async () => {
		const { run, source } = graph({
			url: 'js:return "https://api.test/" + input.id',
			headers: { 'js:return "x-" + "user"': "js:return input.token", accept: "application/json" },
			body: "js:return JSON.stringify({ id: input.id })",
		});
		expect(source).not.toContain("ctx.vm");

		const { ctx, calls } = withHttpClient();
		const result = await run(ctx, { id: 7, token: "t" });

		expect(calls).toEqual([
			{
				url: "https://api.test/7",
				body: { id: 7 },
				headers: { "x-user": "t", accept: "application/json" },
			},
		]);
		expect(result.output).toEqual({ data: "ok", status: 201 });
	});

	it("sends the previous output as body when useParam is set", async () => {
		const { run } = graph({ url: "https://api.test", useParam: true, body: "ignored" });
		const { ctx, calls } = withHttpClient();
		await run(ctx, { a: 1 });
		expect(calls[0].body).toEqual({ a: 1 });
	});
});

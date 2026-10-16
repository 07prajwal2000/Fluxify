import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";
import { openMcpClient, resolveMcpHeaders } from "./client";

const SECRET = "s3cret-value";
let math: Awaited<ReturnType<typeof startMathMcp>>;

// answers only requests carrying `x-api-key: SECRET`
beforeAll(async () => {
	math = await startMathMcp({ headers: { "x-api-key": SECRET } });
});

afterAll(() => math.close());

describe("mcp client", () => {
	it("lists and calls tools, with a cfg: header read from app config", async () => {
		const headers = resolveMcpHeaders(
			[{ key: "x-api-key", value: "cfg:MCP_KEY" }],
			new Map([["MCP_KEY", SECRET]]),
		);
		expect(headers).toEqual({ "x-api-key": SECRET });
		const client = await openMcpClient({ url: math.url, headers });
		try {
			const tools = await client.listTools();
			expect(tools.map((t) => t.name)).toEqual([
				"add",
				"subtract",
				"multiply",
				"divide",
				"sum",
				"slow_add",
			]);
			expect(tools[0].inputSchema.properties).toHaveProperty("a");
			const out = await client.callTool("add", { a: 2, b: 3 });
			expect(out.content).toEqual([{ type: "text", text: "5" }]);
			expect(math.calls).toEqual([{ tool: "add", args: { a: 2, b: 3 } }]);
		} finally {
			await client.close();
		}
	});

	it("a missing cfg: key resolves to an empty value, not the reference", () => {
		expect(resolveMcpHeaders([{ key: "k", value: "cfg:NOPE" }], new Map())).toEqual({ k: "" });
		expect(resolveMcpHeaders([{ key: "k", value: "plain" }], new Map())).toEqual({ k: "plain" });
	});

	it("a wrong header fails cleanly, and the error does not carry the header value", async () => {
		const wrong = "wrong-value-xyz";
		const error = await openMcpClient({ url: math.url, headers: { "x-api-key": wrong } }).then(
			() => undefined,
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect(String(error?.message)).not.toContain(wrong);
	});
});

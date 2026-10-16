import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";

mock.module("../repository", () => ({ getAppConfigs: async () => [] }));
const { testIntegrationConnection } = await import("../service");

let math: Awaited<ReturnType<typeof startMathMcp>>;

// a real MCP server over Streamable HTTP, one required header
beforeAll(async () => {
	math = await startMathMcp({ headers: { "x-api-key": "secret" } });
});

afterAll(() => math.close());

const test = (config: unknown) => testIntegrationConnection("p1", "mcp", "http", config);

describe("test connection: mcp", () => {
	it("lists the server's tools", async () => {
		const result = await test({
			url: math.url,
			headers: [{ key: "x-api-key", value: "secret" }],
		});
		expect(result.success).toBe(true);
		expect(result.error).toBe("");
		expect(result.tools.map((t) => t.name)).toEqual([
			"add",
			"subtract",
			"multiply",
			"divide",
			"sum",
			"slow_add",
		]);
	});

	it("fails with a wrong header", async () => {
		const result = await test({
			url: math.url,
			headers: [{ key: "x-api-key", value: "nope" }],
		});
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it("fails with a bad url", async () => {
		const result = await test({ url: "not a url", headers: [] });
		expect(result.success).toBe(false);
		expect(result.error).toStartWith("Invalid configuration: url:");
	});

	it("fails when nothing listens on the url", async () => {
		const result = await test({ url: "http://127.0.0.1:1/mcp", headers: [] });
		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});
});

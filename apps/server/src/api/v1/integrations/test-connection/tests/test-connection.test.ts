import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

mock.module("../repository", () => ({ getAppConfigs: async () => [] }));
const { testIntegrationConnection } = await import("../service");

let server: Server;
let url: string;

// a real MCP server over Streamable HTTP, one tool, one required header
beforeAll(async () => {
	server = createServer(async (req, res) => {
		if (req.headers["x-api-key"] !== "secret") {
			res.writeHead(401).end("unauthorized");
			return;
		}
		const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
		mcp.registerTool("echo", { description: "Echoes the input" }, async () => ({
			content: [{ type: "text", text: "ok" }],
		}));
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => void mcp.close());
		await mcp.connect(transport);
		await transport.handleRequest(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => {
	server.close();
});

const test = (config: unknown) => testIntegrationConnection("p1", "mcp", "http", config);

describe("test connection: mcp", () => {
	it("lists the server's tools", async () => {
		const result = await test({ url, headers: [{ key: "x-api-key", value: "secret" }] });
		expect(result).toEqual({
			success: true,
			error: "",
			tools: [{ name: "echo", description: "Echoes the input" }],
		});
	});

	it("fails with a wrong header", async () => {
		const result = await test({ url, headers: [{ key: "x-api-key", value: "nope" }] });
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

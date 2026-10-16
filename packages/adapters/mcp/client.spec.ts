import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { openMcpClient, resolveMcpHeaders } from "./client";

const SECRET = "s3cret-value";
let server: Server;
let url: string;

/** A real MCP server that only answers requests carrying `x-api-key: SECRET`. */
beforeAll(async () => {
	server = createServer(async (req, res) => {
		if (req.headers["x-api-key"] !== SECRET) {
			res.writeHead(401).end("unauthorized");
			return;
		}
		const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
		mcp.registerTool(
			"add",
			{ description: "Adds two numbers", inputSchema: { a: z.number(), b: z.number() } },
			async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
		);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => void mcp.close());
		await mcp.connect(transport);
		await transport.handleRequest(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => server.close());

describe("mcp client", () => {
	it("lists and calls tools, with a cfg: header read from app config", async () => {
		const headers = resolveMcpHeaders(
			[{ key: "x-api-key", value: "cfg:MCP_KEY" }],
			new Map([["MCP_KEY", SECRET]]),
		);
		expect(headers).toEqual({ "x-api-key": SECRET });
		const client = await openMcpClient({ url, headers });
		try {
			const tools = await client.listTools();
			expect(tools.map((t) => t.name)).toEqual(["add"]);
			expect(tools[0].inputSchema.properties).toHaveProperty("a");
			const out = await client.callTool("add", { a: 2, b: 3 });
			expect(out.content).toEqual([{ type: "text", text: "5" }]);
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
		const error = await openMcpClient({ url, headers: { "x-api-key": wrong } }).then(
			() => undefined,
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect(String(error?.message)).not.toContain(wrong);
	});
});

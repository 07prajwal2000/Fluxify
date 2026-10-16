import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMathMcp } from "./server";

const HEADERS = { "x-api-key": "test-key" };
const servers: { close(): Promise<void> }[] = [];
const clients: Client[] = [];

afterEach(async () => {
	for (const c of clients.splice(0)) await c.close();
	for (const s of servers.splice(0)) await s.close();
});

async function start(headers: Record<string, string> = HEADERS) {
	const server = await startMathMcp({ headers });
	servers.push(server);
	return server;
}

async function connect(url: string, headers: Record<string, string> = HEADERS) {
	const client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
	clients.push(client);
	return client;
}

const call = (client: Client, name: string, args: Record<string, unknown>) =>
	client.callTool({ name, arguments: args });

describe("math MCP server", () => {
	test("listTools returns the 6 tools", async () => {
		const { url } = await start();
		const { tools } = await (await connect(url)).listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(
			["add", "divide", "multiply", "slow_add", "subtract", "sum"],
		);
	});

	test("each arithmetic tool returns text and structuredContent", async () => {
		const { url } = await start();
		const client = await connect(url);
		const cases: [string, Record<string, unknown>, number][] = [
			["add", { a: 2, b: 3 }, 5],
			["subtract", { a: 2, b: 3 }, -1],
			["multiply", { a: 4, b: 3 }, 12],
			["divide", { a: 9, b: 3 }, 3],
			["sum", { numbers: [1, 2, 3, 4] }, 10],
			["slow_add", { a: 1, b: 1, ms: 0 }, 2],
		];
		for (const [name, args, expected] of cases) {
			const result = await call(client, name, args);
			expect(result.isError).toBeFalsy();
			expect(result.content).toEqual([{ type: "text", text: String(expected) }]);
			expect(result.structuredContent).toEqual({ result: expected });
		}
	});

	test("divide by zero gives isError, not a thrown error", async () => {
		const { url } = await start();
		const result = await call(await connect(url), "divide", { a: 1, b: 0 });
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("Division by zero");
	});

	test("a missing or wrong header fails, the right header passes", async () => {
		const { url } = await start();
		const post = (headers: Record<string, string>) =>
			fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					...headers,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
			});
		expect((await post({})).status).toBe(401);
		expect((await post({ "x-api-key": "wrong" })).status).toBe(401);
		expect((await post(HEADERS)).status).toBe(200);
		await expect(connect(url, {})).rejects.toThrow();
	});

	test("calls records each tool call", async () => {
		const server = await start();
		const client = await connect(server.url);
		await call(client, "add", { a: 1, b: 2 });
		await call(client, "divide", { a: 1, b: 0 });
		expect(server.calls).toEqual([
			{ tool: "add", args: { a: 1, b: 2 } },
			{ tool: "divide", args: { a: 1, b: 0 } },
		]);
	});

	test("a denied call is not recorded", async () => {
		const server = await start();
		await expect(connect(server.url, {})).rejects.toThrow();
		expect(server.calls).toHaveLength(0);
	});

	test("close() frees the port", async () => {
		const server = await startMathMcp({ headers: HEADERS });
		const port = Number(new URL(server.url).port);
		await server.close();
		const again = await startMathMcp({ port, headers: HEADERS });
		servers.push(again);
		expect(Number(new URL(again.url).port)).toBe(port);
	});

	test("two servers run at once on random ports", async () => {
		const a = await start();
		const b = await start();
		expect(a.url).not.toBe(b.url);
		const result = await call(await connect(b.url), "add", { a: 2, b: 2 });
		expect(result.structuredContent).toEqual({ result: 4 });
		expect(a.calls).toHaveLength(0);
		expect(b.calls).toHaveLength(1);
	});
});

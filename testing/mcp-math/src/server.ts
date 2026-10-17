import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createAuthServer, type OAuthControls, type OAuthOptions } from "./oauth";

export type { OAuthControls, OAuthOptions };

export type MathCall = { tool: string; args: unknown };

const ab = { a: z.number(), b: z.number() };
const output = { result: z.number() };
const ok = (result: number) => ({
	content: [{ type: "text" as const, text: String(result) }],
	structuredContent: { result },
});

// Stateless: a fresh McpServer and transport per request, so no session ids.
// `oauth` turns on OAuth mode: calls need an access token from the server's own tiny
// authorization server. Header mode (the default) is unchanged.
export async function startMathMcp(
	opts: {
		port?: number;
		headers?: Record<string, string>;
		name?: string;
		oauth?: OAuthOptions;
	} = {},
): Promise<{ url: string; close(): Promise<void>; calls: MathCall[]; oauth?: OAuthControls }> {
	const calls: MathCall[] = [];
	let origin = "";
	const authServer = opts.oauth && createAuthServer(() => origin, opts.oauth);
	const required = Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]);

	const buildServer = () => {
		const server = new McpServer({ name: opts.name ?? "math", version: "1.0.0" });
		const record = (tool: string, args: unknown) => calls.push({ tool, args });

		server.registerTool(
			"add",
			{ description: "Add two numbers.", inputSchema: ab, outputSchema: output },
			({ a, b }) => {
				record("add", { a, b });
				return ok(a + b);
			},
		);
		server.registerTool(
			"subtract",
			{ description: "Subtract b from a.", inputSchema: ab, outputSchema: output },
			({ a, b }) => {
				record("subtract", { a, b });
				return ok(a - b);
			},
		);
		server.registerTool(
			"multiply",
			{ description: "Multiply two numbers.", inputSchema: ab, outputSchema: output },
			({ a, b }) => {
				record("multiply", { a, b });
				return ok(a * b);
			},
		);
		server.registerTool(
			"divide",
			{
				description: "Divide a by b. Returns a tool error when b is 0.",
				inputSchema: ab,
				outputSchema: output,
			},
			({ a, b }) => {
				record("divide", { a, b });
				if (b === 0) {
					return { isError: true, content: [{ type: "text" as const, text: "Division by zero" }] };
				}
				return ok(a / b);
			},
		);
		server.registerTool(
			"sum",
			{
				description: "Sum a list of numbers.",
				inputSchema: { numbers: z.array(z.number()) },
				outputSchema: output,
			},
			({ numbers }) => {
				record("sum", { numbers });
				return ok(numbers.reduce((total, n) => total + n, 0));
			},
		);
		server.registerTool(
			"slow_add",
			{
				description: "Wait ms milliseconds (max 10000), then add a and b.",
				inputSchema: { ...ab, ms: z.number().min(0) },
				outputSchema: output,
			},
			async ({ a, b, ms }) => {
				record("slow_add", { a, b, ms });
				await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10000)));
				return ok(a + b);
			},
		);
		return server;
	};

	const handle = async (req: IncomingMessage, res: ServerResponse) => {
		if (authServer && (await authServer.handle(req, res))) return;
		if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
			res.writeHead(404).end();
			return;
		}
		if (authServer && !authServer.authorize(req, res)) return;
		if (required.some(([k, v]) => req.headers[k] !== v)) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "unauthorized" }));
			return;
		}
		const server = buildServer();
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => {
			transport.close();
			server.close();
		});
		await server.connect(transport);
		await transport.handleRequest(req, res);
	};

	const http = createServer((req, res) => {
		handle(req, res).catch(() => {
			if (!res.headersSent) res.writeHead(500).end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		http.once("error", reject);
		http.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
	});
	const { port } = http.address() as AddressInfo;
	origin = `http://127.0.0.1:${port}`;

	return {
		url: `${origin}/mcp`,
		calls,
		oauth: authServer?.controls,
		close: () =>
			new Promise<void>((resolve) => {
				http.close(() => resolve());
				http.closeAllConnections();
			}),
	};
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** An `mcp` integration's config with its headers resolved. Header values are secrets: never log them. */
export type McpConnection = { url: string; headers: Record<string, string> };

/** Stored `{ key, value }` headers -> request headers, `cfg:KEY` values read from `appConfigs`. */
export function resolveMcpHeaders(
	headers: { key: string; value: string }[] = [],
	appConfigs: Map<string, string>,
) {
	return Object.fromEntries(
		headers.map((h) => [
			h.key,
			h.value.startsWith("cfg:") ? (appConfigs.get(h.value.slice(4)) ?? "") : h.value,
		]),
	);
}

/** Connects over Streamable HTTP. Close it when done. */
export async function openMcpClient({ url, headers }: McpConnection) {
	const client = new Client({ name: "fluxify", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
	);
	return {
		listTools: async () => (await client.listTools()).tools,
		callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
			client.callTool({ name, arguments: args }, undefined, { signal }),
		close: () => client.close().catch(() => {}),
	};
}

export type McpClient = Awaited<ReturnType<typeof openMcpClient>>;

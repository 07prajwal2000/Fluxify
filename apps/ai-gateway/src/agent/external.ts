import { type McpClient, openMcpClient } from "@fluxify/adapters";
import { jsonSchema, type Tool, tool } from "ai";
import { z } from "zod";

/** Tools from the project's external MCP servers (#821) are named `ext_<server>__<tool>`. */
export const EXT = "ext_";
export const isExternal = (name: string) => name.startsWith(EXT);
/** The server part of an `ext_` name, for the approval card; undefined for any other tool. */
export const serverOf = (name: string) =>
	isExternal(name) ? name.slice(EXT.length).split("__")[0] : undefined;

export const LIST_MCP_TOOLS = "list_mcp_tools";

/** An allowed `mcp` integration as the loader caches it (headers resolved: never log them). */
export type McpConfig = { id: string; name: string; url: string; headers: Record<string, string> };

type McpToolInfo = Awaited<ReturnType<McpClient["listTools"]>>[number];
/** One open server for this job; `error` when it could not be reached. */
export type ExternalServer = {
	id: string;
	name: string;
	client?: McpClient;
	tools: McpToolInfo[];
	error?: string;
};

/** Tool-name charset; no `__` so the server part splits off cleanly. */
const clean = (s: string) =>
	s
		.replace(/[^a-zA-Z0-9-]+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 24) || "server";

/** Opens every server and lists its tools. One that fails is kept with its error; nothing throws. */
export async function openServers(configs: McpConfig[]): Promise<ExternalServer[]> {
	const taken = new Set<string>();
	return Promise.all(
		configs.map(async ({ id, name, url, headers }) => {
			let short = clean(name);
			for (let i = 2; taken.has(short); i++) short = `${clean(name)}-${i}`;
			taken.add(short);
			try {
				const client = await openMcpClient({ url, headers });
				try {
					return { id, name: short, client, tools: await client.listTools() };
				} catch (e) {
					await client.close();
					throw e;
				}
			} catch (e) {
				// the message only: an error object can carry the request, headers included
				return { id, name: short, tools: [], error: e instanceof Error ? e.message : String(e) };
			}
		}),
	);
}

export const closeServers = (servers: ExternalServer[]) =>
	Promise.all(servers.map((s) => s.client?.close()));

export const extName = (s: ExternalServer, t: McpToolInfo) =>
	`${EXT}${s.name}__${t.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** `@server` in the message (integration ids): all its tools start loaded. Ids of servers not open here do nothing. */
export function preloadMentioned(
	servers: ExternalServer[],
	mentions: string[] = [],
	load: (name: string) => boolean,
) {
	for (const s of servers)
		if (mentions.includes(s.id)) for (const t of s.tools) load(extName(s, t));
}

/** `ext_` tools plus list_mcp_tools, for agentTools. */
export function externalTools(servers: ExternalServer[]): Record<string, Tool> {
	const tools: Record<string, Tool> = {};
	for (const s of servers) {
		for (const t of s.tools) {
			tools[extName(s, t)] = tool({
				title: `${t.title ?? t.name} (${s.name})`,
				description: t.description ?? t.name,
				inputSchema: jsonSchema(t.inputSchema as never),
				execute: (args, { abortSignal }) =>
					s.client!.callTool(t.name, args as Record<string, unknown>, abortSignal),
			});
		}
	}
	tools[LIST_MCP_TOOLS] = tool({
		title: "List MCP tools",
		description:
			"The project's external MCP servers. No server: each one with its tool count. With a server: its tools, one line each. Load them with load_tools; every call asks the user.",
		inputSchema: z.object({ server: z.string().optional() }),
		execute: async ({ server }) => {
			if (!server)
				return servers.map((s) =>
					s.error ? { name: s.name, error: s.error } : { name: s.name, tools: s.tools.length },
				);
			const s = servers.find((x) => x.name === server);
			if (!s) return { error: `No MCP server named ${server}` };
			if (s.error) return { error: s.error };
			return s.tools.map((t) => `${extName(s, t)}: ${(t.description ?? "").split("\n")[0]}`);
		},
	});
	return tools;
}

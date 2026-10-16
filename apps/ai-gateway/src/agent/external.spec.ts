import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as server from "@fluxify/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AdminFetch } from "../mcp/adminApi";
import { agentMcpServers } from "./runner/integration";
import { closeServers, type ExternalServer, openServers, preloadMentioned } from "./external";
import { agentTools, needsApproval, titleOf } from "./tools";

const P = "019a0000-0000-7000-8000-000000000000";
let http: Server;
let url: string;

beforeAll(async () => {
	http = createServer(async (req, res) => {
		const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
		mcp.registerTool(
			"echo",
			{ description: "Echoes the text\nsecond line", inputSchema: { text: z.string() } },
			async ({ text }) => ({ content: [{ type: "text", text }] }),
		);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => void mcp.close());
		await mcp.connect(transport);
		await transport.handleRequest(req, res);
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(() => http.close());

const fetcher: AdminFetch = () => Response.json({});
const exec = (t: any, input: unknown) => t.execute(input, { toolCallId: "c1", messages: [] });

const open = () =>
	openServers([
		{ id: "a", name: "My Server!", url, headers: {} },
		{ id: "b", name: "down", url: "http://127.0.0.1:1/mcp", headers: {} },
	]);

describe("external MCP tools (#821)", () => {
	it("list_mcp_tools shows a reachable and an unreachable server; the run goes on", async () => {
		const servers = await open();
		try {
			const { tools } = agentTools(fetcher, {}, P, new Set(), undefined, servers);
			const all = await exec(tools.list_mcp_tools, {});
			expect(all[0]).toEqual({ name: "My_Server", tools: 1 });
			expect(all[1].name).toBe("down");
			expect(all[1].error).toBeTruthy();
			expect(await exec(tools.list_mcp_tools, { server: "My_Server" })).toEqual([
				"ext_My_Server__echo: Echoes the text",
			]);
			expect((await exec(tools.list_mcp_tools, { server: "down" })).error).toBeTruthy();
			expect(await exec(tools.ext_My_Server__echo, { text: "hi" })).toMatchObject({
				content: [{ type: "text", text: "hi" }],
			});
		} finally {
			await closeServers(servers);
		}
	});

	it("load_tools takes ext_ names of open servers only, and they stay loaded across messages", async () => {
		const servers = await open();
		try {
			const loaded = new Set<string>();
			const { tools, active } = agentTools(fetcher, {}, P, loaded, undefined, servers);
			expect(active()).not.toContain("ext_My_Server__echo");
			expect(
				await exec(tools.load_tools, { names: ["ext_My_Server__echo", "ext_other__echo"] }),
			).toEqual({ loaded: ["ext_My_Server__echo"], unknown: ["ext_other__echo"] });
			expect(agentTools(fetcher, {}, P, loaded, undefined, servers).active()).toContain(
				"ext_My_Server__echo",
			);
			// the server left the setting: the next message drops it
			expect(agentTools(fetcher, {}, P, loaded).active()).not.toContain("ext_My_Server__echo");
		} finally {
			await closeServers(servers);
		}
	});

	it("@ preloads a mentioned server's tools; an id not open here does nothing", async () => {
		const servers: ExternalServer[] = [
			{ id: "a", name: "gh", tools: [{ name: "issue", inputSchema: { type: "object" } }] },
		];
		const { active, load } = agentTools(fetcher, {}, P, new Set(), undefined, servers);
		preloadMentioned(servers, ["nope"], load);
		expect(active()).not.toContain("ext_gh__issue");
		preloadMentioned(servers, ["a"], load);
		expect(active()).toContain("ext_gh__issue");
	});

	it("ext_ calls always ask and are titled with their server", () => {
		expect(needsApproval("auto", "ext_gh__issue")).toBe(true);
		expect(needsApproval("manual", "ext_gh__issue")).toBe(true);
		expect(needsApproval("auto", "list_mcp_tools")).toBe(false);
		expect(titleOf("ext_gh__create_issue")).toBe("create_issue (gh)");
	});

	it("only servers in the project's setting, owned by the project, are offered", async () => {
		const setting = spyOn(server, "getProjectSetting").mockResolvedValue(`a,b,ghost,a`);
		const mcp = server.mcpIntegrationsCache;
		mcp.a = { name: "A", url, headers: {}, __projectId: P };
		mcp.b = { name: "B", url, headers: {}, __projectId: "someone-else" };
		mcp.c = { name: "C", url, headers: {}, __projectId: P };
		try {
			expect((await agentMcpServers(P)).map((s) => s.id)).toEqual(["a"]);
		} finally {
			setting.mockRestore();
			delete mcp.a;
			delete mcp.b;
			delete mcp.c;
		}
	});
});

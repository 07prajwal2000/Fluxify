import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";
import { adminCall, type McpStack, startMcpStack, stopMcpStack } from "../src/mcp";
import { uniq } from "../src/mcpRows";

// External MCP servers (#820/#823): an `mcp` integration against a real math MCP server over
// Streamable HTTP, through the real admin API. The agent side is in
// apps/ai-gateway/src/agent/externalMcp.test.ts.

const KEY = "k-123";
const TOOLS = ["add", "subtract", "multiply", "divide", "sum", "slow_add"];

let stack: McpStack;
let math: Awaited<ReturnType<typeof startMathMcp>>;
let devMath: Awaited<ReturnType<typeof startMathMcp>>;

beforeAll(async () => {
	[stack, math, devMath] = await Promise.all([
		startMcpStack(),
		startMathMcp({ headers: { "x-api-key": KEY }, name: "prod-math" }),
		startMathMcp({ headers: { "x-api-key": KEY }, name: "dev-math" }),
	]);
}, 300_000);

afterAll(async () => {
	await Promise.all([math?.close(), devMath?.close()]);
	await stopMcpStack();
});

const p = () => stack.projectId;
const as = (role: "creator" | "project_admin") => stack.tokens[role];
const call = (role: "creator" | "project_admin", path: string, method?: string, body?: object) =>
	adminCall(stack, as(role), { path: `/v1/${p()}${path}`, method, body });

/** An app config key holding the API key, which the header refers to as `cfg:<name>`. */
async function keyConfig(value = KEY) {
	const keyName = uniq("MCP_KEY_");
	const res = await call("project_admin", "/app-config", "POST", {
		keyName,
		value,
		description: "",
		isEncrypted: false,
		encodingType: "plaintext",
		syncDev: true,
	});
	expect(res.status).toBeLessThan(300);
	return keyName;
}

const config = (url: string, keyName: string) => ({
	url,
	headers: [{ key: "x-api-key", value: `cfg:${keyName}` }],
});

async function create(body: object) {
	const res = await call("project_admin", "/integrations", "POST", {
		name: uniq("math-"),
		group: "mcp",
		variant: "http",
		...body,
	});
	expect(res.status).toBeLessThan(300);
	return res.body.id as string;
}

describe("mcp integration", () => {
	it("an admin saves it with a cfg: header and test connection lists the 6 tools", async () => {
		const id = await create({ config: config(math.url, await keyConfig()), syncDev: true });
		const res = await call("project_admin", `/integrations/test-existing-connection/${id}`);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS);
	});

	it("a wrong key fails test connection with the reason", async () => {
		const id = await create({ config: config(math.url, await keyConfig("nope")), syncDev: true });
		const res = await call("project_admin", `/integrations/test-existing-connection/${id}`);
		expect(res.status).toBe(400);
		expect(res.body.message ?? res.body.error).toBeTruthy();
	});

	it("a creator cannot create, update or delete, but can read", async () => {
		const cfg = config(math.url, await keyConfig());
		const id = await create({ config: cfg, syncDev: true });
		const body = { name: uniq("math-"), group: "mcp", variant: "http", config: cfg };
		expect((await call("creator", "/integrations", "POST", body)).status).toBe(403);
		expect(
			(await call("creator", `/integrations/${id}`, "PUT", { name: "renamed", config: cfg })).status,
		).toBe(403);
		expect((await call("creator", `/integrations/${id}`, "DELETE")).status).toBe(403);
		const read = await call("creator", `/integrations/${id}`);
		expect(read.status).toBe(200);
		expect(read.body.group).toBe("mcp");
		expect((await call("creator", "/integrations/list/mcp")).status).toBe(200);
		// untouched by the refused calls
		expect((await call("project_admin", `/integrations/${id}`)).body.name).not.toBe("renamed");
	});

	it("the project saves which servers its agent may use", async () => {
		const id = await create({ config: config(math.url, await keyConfig()), syncDev: true });
		const put = await adminCall(stack, as("creator"), {
			path: `/v1/projects/${p()}/settings/keys`,
			method: "PUT",
			body: { key: "settings.ai.agentMcpIntegrations", value: id },
		});
		expect(put.status).toBeLessThan(300);
		const all = await adminCall(stack, as("creator"), {
			path: `/v1/projects/${p()}/settings/keys`,
		});
		expect(all.body["settings.ai.agentMcpIntegrations"]).toBe(id);
		const bad = await adminCall(stack, as("creator"), {
			path: `/v1/projects/${p()}/settings/keys`,
			method: "PUT",
			body: { key: "settings.ai.agentMcpIntegrations", value: "not-an-id" },
		});
		expect(bad.status).toBe(400);
	});

	it("dev uses devConfig unless 'same as prod' is on", async () => {
		// production points at a server that refuses the call (no key), development at one that answers
		const noKey = { url: math.url, headers: [] };
		const dev = config(devMath.url, await keyConfig());
		const id = await create({ config: noKey, devConfig: dev, syncDev: false });
		const test = () => call("project_admin", `/integrations/test-existing-connection/${id}`);

		const own = await test();
		expect(own.status).toBe(200);
		expect(own.body.tools).toHaveLength(6);

		const synced = await call("project_admin", `/integrations/${id}`, "PUT", {
			name: uniq("math-"),
			config: noKey,
			devConfig: dev,
			syncDev: true,
		});
		expect(synced.status).toBeLessThan(300);
		// "same as prod": development now reads the production config, which has no key
		expect((await test()).status).toBe(400);
	});
});

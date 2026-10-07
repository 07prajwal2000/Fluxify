import { join } from "node:path";
import type { Subprocess } from "bun";

/** What `mcpStack.ts` seeded: one project with a row of every resource, and API keys per role. */
export type McpStack = {
	url: string;
	projectId: string;
	otherProjectId: string;
	/** viewer / creator / project_admin in `projectId`; `other` is a viewer in `otherProjectId` only */
	tokens: Record<"viewer" | "creator" | "project_admin" | "other", string>;
	/** three users with accounts who are not in `projectId`, for the member tools */
	users: { id: string; email: string }[];
	ids: Record<
		"route" | "workflow" | "trigger" | "customBlock" | "middleware" | "testSuite" | "integration",
		string
	> & { appConfig: number };
};

let proc: Subprocess<"pipe", "pipe", "inherit"> | undefined;

/** Starts the admin + MCP server in its own process and waits for it to serve. */
export async function startMcpStack(): Promise<McpStack> {
	proc = Bun.spawn(["bun", join(import.meta.dir, "mcpStack.ts")], {
		cwd: join(import.meta.dir, ".."),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "inherit",
	});
	const decoder = new TextDecoder();
	const reader = proc.stdout.getReader();
	let buffered = "";
	for (let r = await reader.read(); !r.done; r = await reader.read()) {
		buffered += decoder.decode(r.value);
		const line = buffered.split("\n").find((l) => l.startsWith("MCP_STACK "));
		if (!line) continue;
		// keep reading its logs: once the pipe closes, the stack's next log
		// write fails, and with it the request that logged
		void (async () => {
			while (!(await reader.read()).done) {}
		})();
		return JSON.parse(line.slice("MCP_STACK ".length));
	}
	throw new Error(`MCP stack exited before serving (code ${await proc.exited})`);
}

/** Closing stdin tells the stack to remove its containers and exit. */
export async function stopMcpStack() {
	if (!proc) return;
	proc.stdin.end();
	await Promise.race([proc.exited, Bun.sleep(30_000)]);
	proc.kill();
	proc = undefined;
}

let rpcId = 0;

/** One JSON-RPC call to the MCP endpoint, as a client holding `token`. */
export async function mcp(stack: McpStack, token: string, method: string, params: object = {}) {
	const res = await fetch(`${stack.url}/_/admin/mcp`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
	});
	if (res.status !== 200) throw new Error(`MCP ${method}: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { result: any }).result;
}

/** Calls a tool; `text` is its JSON result or its error message. */
export async function callTool(stack: McpStack, token: string, name: string, args: object) {
	const result = await mcp(stack, token, "tools/call", { name, arguments: args });
	return { ok: !result.isError, text: result.content[0].text as string };
}

/** A request made straight to the admin API, as `token`. */
export type AdminCall = { method?: string; path: string; body?: object };

export async function adminCall(stack: McpStack, token: string, call: AdminCall) {
	const res = await fetch(`${stack.url}/_/admin/api${call.path}`, {
		method: call.method ?? "GET",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: call.body && JSON.stringify(call.body),
	});
	return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** The status of the same call made straight to the admin API. */
export async function adminStatus(stack: McpStack, token: string, call: string | AdminCall) {
	return (await adminCall(stack, token, typeof call === "string" ? { path: call } : call)).status;
}

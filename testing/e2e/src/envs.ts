import { join } from "node:path";
import type { Subprocess } from "bun";

/** What `envStack.ts` set up: an admin, a production and a development worker, and their data. */
export type EnvStack = {
	url: string;
	workers: { production: string; development: string };
	projectId: string;
	creatorId: string;
	/** the data Postgres behind each environment */
	data: Record<"production" | "development", { port: number; password: string; database: string }>;
	tokens: { creator: string; viewer: string };
	/** a signed-in browser session: what the portal sends */
	portalCookie: string;
};

let proc: Subprocess<"pipe", "pipe", "inherit"> | undefined;

/** Starts the stack in its own process and waits for it to serve. */
export async function startEnvStack(): Promise<EnvStack> {
	proc = Bun.spawn(["bun", join(import.meta.dir, "envStack.ts")], {
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
		const line = buffered.split("\n").find((l) => l.startsWith("ENV_STACK "));
		if (!line) continue;
		// keep draining: a closed pipe fails the stack's next log write
		void (async () => {
			for (let r = await reader.read(); !r.done; r = await reader.read()) {
				// ENV_STACK_DEBUG=1 shows the stack's own log
				if (process.env.ENV_STACK_DEBUG) process.stderr.write(decoder.decode(r.value));
			}
		})();
		return JSON.parse(line.slice("ENV_STACK ".length));
	}
	throw new Error(`env stack exited before serving (code ${await proc.exited})`);
}

/** Closing stdin tells the stack to stop its workers and remove its containers. */
export async function stopEnvStack() {
	if (!proc) return;
	proc.stdin.end();
	await Promise.race([proc.exited, Bun.sleep(60_000)]);
	proc.kill();
	proc = undefined;
}

/** One admin API call as the creator's token, or as the portal's cookie. */
export async function api(
	stack: EnvStack,
	as: "creator" | "viewer" | "portal",
	path: string,
	init: { method?: string; body?: unknown } = {},
) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (as === "portal") {
		headers.cookie = stack.portalCookie;
		// better-auth checks it on a cookie login
		headers.origin = "http://localhost:8080";
	} else {
		headers.authorization = `Bearer ${stack.tokens[as]}`;
	}
	const res = await fetch(`${stack.url}/_/admin/api${path}`, {
		method: init.method ?? (init.body === undefined ? "GET" : "POST"),
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** A tool call on the MCP endpoint, as a client holding `token`. */
export async function mcpTool(stack: EnvStack, token: string, name: string, args: object) {
	const res = await fetch(`${stack.url}/_/admin/mcp`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	if (res.status !== 200) throw new Error(`MCP ${name}: ${res.status} ${await res.text()}`);
	const { result } = (await res.json()) as { result: any };
	return { ok: !result.isError, text: result.content[0].text as string };
}

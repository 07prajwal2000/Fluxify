import { join } from "node:path";
import type { Subprocess } from "bun";
import { SQL } from "bun";

/** What `auditStack.ts` serves: an Enterprise admin with the audit consumer running. */
export type AuditStack = {
	url: string;
	pgUrl: string;
	natsContainer: string;
	/** a project with audit logs on, made straight in the database */
	projectId: string;
	admin: { id: string; email: string };
	/** one way in per `source`: a browser cookie, a personal token, an agent run token, an OAuth (MCP) token */
	tokens: Record<"cookie" | "pat" | "agent" | "oauth", string>;
};

/** The origin the harness configured Better Auth for; a cookie request must send it. */
export const ORIGIN = "http://localhost:8080";

let proc: Subprocess<"pipe", "pipe", "inherit"> | undefined;

/** Starts the stack in its own process and waits for it to serve. */
export async function startAuditStack(): Promise<AuditStack> {
	proc = Bun.spawn(["bun", join(import.meta.dir, "auditStack.ts")], {
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
		const line = buffered.split("\n").find((l) => l.startsWith("AUDIT_STACK "));
		if (!line) continue;
		// keep reading its logs: once the pipe closes, its next log write fails
		void (async () => {
			while (!(await reader.read()).done) {}
		})();
		return JSON.parse(line.slice("AUDIT_STACK ".length));
	}
	throw new Error(`audit stack exited before serving (code ${await proc.exited})`);
}

/** Closing stdin tells the stack to remove its containers and exit. */
export async function stopAuditStack() {
	if (!proc) return;
	proc.stdin.end();
	await Promise.race([proc.exited, Bun.sleep(30_000)]);
	proc.kill();
	proc = undefined;
}

export type Way =
	| { cookie: string }
	| { bearer: string; via?: "mcp" };

/** One request to the admin API, as `way`. */
export async function admin(stack: AuditStack, way: Way, method: string, path: string, body?: object) {
	const headers: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" };
	if ("cookie" in way) headers.cookie = way.cookie;
	else {
		headers.authorization = `Bearer ${way.bearer}`;
		if (way.via) headers["x-fluxify-via"] = way.via;
	}
	const res = await fetch(`${stack.url}/_/admin/api${path}`, {
		method,
		headers,
		body: body && JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** One JSON-RPC call to the MCP endpoint, as a client holding `token`. */
export async function mcpTool(stack: AuditStack, token: string, name: string, args: object) {
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
	const result = ((await res.json()) as { result: any }).result;
	return { ok: !result.isError, text: result.content[0].text as string };
}

export type AuditRow = {
	id: string;
	ts: Date;
	actor_id: string;
	actor_email: string;
	source: string;
	project_id: string | null;
	project_name: string | null;
	project_slug: string | null;
	resource_type: string;
	resource_id: string;
	action: string;
	changed_fields: string[];
	status: string;
	message: string | null;
};

/** Reads the audit table the way an operator would. */
export function auditDb(stack: AuditStack) {
	const sql = new SQL(stack.pgUrl);
	return {
		sql,
		rows: async (where: string, ...params: unknown[]) =>
			(await sql.unsafe(`SELECT * FROM audit_events WHERE ${where} ORDER BY ts`, params)) as AuditRow[],
		/** polls until at least `n` rows match: events land after a short batch wait */
		waitFor: async (where: string, n = 1, ...params: unknown[]) => {
			const deadline = Date.now() + 20_000;
			for (;;) {
				const rows = (await sql.unsafe(
					`SELECT * FROM audit_events WHERE ${where} ORDER BY ts`,
					params,
				)) as AuditRow[];
				if (rows.length >= n) return rows;
				if (Date.now() > deadline) throw new Error(`no audit rows for: ${where}`);
				await Bun.sleep(100);
			}
		},
		close: () => sql.close(),
	};
}

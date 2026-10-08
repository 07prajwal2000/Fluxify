import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { docsTools } from "../docsTools";
import { mapMcpServer } from "../index";
import { readTools } from "../tools";
import { writeTools } from "../writeTools";

const USERS: Record<string, { user: object; acl: object[] }> = {
	alice: {
		user: { id: "u-alice", email: "alice@test.local", isSystemAdmin: false },
		acl: [{ projectId: "p1", role: "viewer" }],
	},
	bob: {
		user: { id: "u-bob", email: "bob@test.local", isSystemAdmin: true },
		acl: [{ projectId: "*", role: "system_admin" }],
	},
};

// Stands in for setSession: the `x-user` header picks who is signed in.
const app = new Hono<any>();
app.use("*", async (c, next) => {
	const who = USERS[c.req.header("x-user") ?? ""];
	c.set("user", who?.user ?? null);
	c.set("acl", who?.acl ?? null);
	await next();
});
mapMcpServer(app);

function rpc(user: string | undefined, method: string, params: object = {}) {
	return app.request("http://localhost/_/admin/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(user ? { "x-user": user } : {}),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

async function whoami(user: string) {
	const init = await rpc(user, "initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "spec", version: "0" },
	});
	expect(init.status).toBe(200);
	const res = await rpc(user, "tools/call", { name: "whoami", arguments: {} });
	const body = (await res.json()) as { result: { content: { text: string }[] } };
	return JSON.parse(body.result.content[0].text);
}

describe("MCP whoami", () => {
	it("each request sees only its own caller", async () => {
		const [alice, bob] = await Promise.all([whoami("alice"), whoami("bob")]);
		expect(alice).toEqual({ ...USERS.alice.user, acl: USERS.alice.acl });
		expect(bob).toEqual({ ...USERS.bob.user, acl: USERS.bob.acl });
	});

	it("lists reads as read-only and writes with their own annotations", async () => {
		const res = await rpc("alice", "tools/list");
		const body = (await res.json()) as { result: { tools: { name: string; annotations: object }[] } };
		const listed = Object.fromEntries(body.result.tools.map((t) => [t.name, t.annotations]));
		expect(Object.keys(listed)).toContain("whoami");
		for (const tool of [...readTools, ...docsTools]) expect(listed[tool.name]).toEqual({ readOnlyHint: true });
		for (const tool of writeTools) expect(listed[tool.name]).toEqual(tool.annotations!);
	});

	it("401s without a user", async () => {
		expect((await rpc(undefined, "tools/list")).status).toBe(401);
	});
});

describe("MCP initialize", () => {
	it("sends the build guide as server instructions", async () => {
		const res = await rpc("alice", "initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "spec", version: "0" },
		});
		const body = (await res.json()) as { result: { instructions: string } };
		expect(body.result.instructions).toContain("https://docs.fluxify.rest/llms.txt");
		expect(body.result.instructions.split("\n").length).toBeLessThanOrEqual(40);
	});

	it("serves block schemas without a project", async () => {
		const res = await rpc("alice", "tools/call", {
			name: "get_block_schemas",
			arguments: { blockTypes: ["if"] },
		});
		const body = (await res.json()) as { result: { content: { text: string }[] } };
		expect(body.result.content[0].text).toStartWith("type ");
		expect(body.result.content[0].text).toContain("\nif {");
	});

	it("gives each requested block its output and an example, the listing neither (#673)", async () => {
		const call = async (args: object) => {
			const res = await rpc("alice", "tools/call", { name: "get_block_schemas", arguments: args });
			return ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0]
				.text;
		};
		const text = await call({ blockTypes: ["httpgetrequestbody", "db_delete"] });
		expect(text).toContain("Output (the next block's input): The request body itself");
		expect(text).toContain("input.email (not input.body.email)");
		expect(text).toContain('Example data: {"connection":"<integration id>","tableName":"users"');
		expect(await call({})).not.toContain("Example data");
	});

	it("lists each block's handles and ends the listing with a hint; takes blockTypes as a JSON string", async () => {
		const call = async (args: object) => {
			const res = await rpc("alice", "tools/call", { name: "get_block_schemas", arguments: args });
			return ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0]
				.text;
		};
		const text = await call({ blockTypes: '["if", "response"]' });
		expect(text).toContain("Handles (connect from): success, failure");
		expect(text).toContain("Handles (connect from): none, it ends the flow");
		expect(await call({})).toEndWith("Call again with blockTypes for each block's fields, handles, output and an example.");
	});
});

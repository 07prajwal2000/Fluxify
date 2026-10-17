// MCP OAuth (#824), the agent's side against a real database: the agent uses the stored
// tokens, a refresh is saved with compare-and-set, two refreshes at once end with one valid
// token set, and "same as production" writes to production's config.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { McpNotConnectedError, type McpOAuth, openMcpClient } from "@fluxify/adapters";
import { startMathMcp } from "@fluxify/mcp-math";
import { req, stopAuthServer } from "../mcp/tests/authHarness";
import {
	api,
	connectEnv,
	createOAuthIntegration,
	type Env,
	type Math,
	type Stack,
	startStack,
	storedRow,
	storedTokens,
	waitFor,
} from "./mcpOAuthHarness";

let stack: Stack;
let math: Math;
let server: typeof import("@fluxify/server");
let store: typeof import("@fluxify/server/src/api/v1/integrations/mcp-oauth/store");

beforeAll(async () => {
	[stack, math] = await Promise.all([startStack(), startMathMcp({ oauth: { accessTtlMs: 60_000 } })]);
	server = await import("@fluxify/server");
	store = await import("@fluxify/server/src/api/v1/integrations/mcp-oauth/store");
}, 300_000);

afterAll(async () => {
	await math?.close();
	// the compile worker is still acknowledging the saves; closing NATS under it is an unhandled error
	await Bun.sleep(1500);
	await stopAuthServer();
});

/** A stored connection as a separate process would load it: its own state, the same database. */
async function loadOAuth(id: string, env: Env = "production"): Promise<McpOAuth> {
	const oauth = store.mcpOAuthFor(await storedRow(stack, id), env);
	if (!oauth) throw new Error("not connected");
	return oauth;
}

/** One `add` call through the shared client, as the agent makes it. */
async function add(oauth: McpOAuth, a: number, b: number) {
	const client = await openMcpClient({ url: math.url, auth: "oauth", oauth });
	try {
		const out = await client.callTool("add", { a, b });
		return (out.content as { text: string }[])[0].text;
	} finally {
		await client.close();
	}
}

const connected = async (extra?: Parameters<typeof createOAuthIntegration>[2]) => {
	const id = await createOAuthIntegration(stack, math, extra ?? { syncDev: true });
	await connectEnv(stack, id, "production");
	return id;
};

describe("the agent", () => {
	it("calls a tool of an allowed, connected server with the stored token", async () => {
		const id = await connected();
		const put = await req(stack.s, `/_/admin/api/v1/projects/${stack.projectId}/settings/keys`, {
			method: "PUT",
			cookie: stack.admin,
			json: { key: "settings.ai.agentMcpIntegrations", value: id },
		});
		expect(put.status).toBeLessThan(300);
		// the integration loader reloads on the change the callback published
		await waitFor(() => server.mcpIntegrationsCache[id]?.oauth);
		const { agentMcpServers } = await import("./runner/integration");
		const configs = await waitFor(async () => {
			const found = await agentMcpServers(stack.projectId);
			return found.some((c) => c.id === id) ? found : undefined;
		});
		const { openServers, closeServers } = await import("./external");
		const servers = await openServers(configs.filter((c) => c.id === id));
		try {
			expect(servers[0].error).toBeUndefined();
			expect(servers[0].tools.map((t) => t.name)).toContain("add");
			const out = await servers[0].client!.callTool("add", { a: 20, b: 22 });
			expect(out.content).toEqual([{ type: "text", text: "42" }]);
		} finally {
			await closeServers(servers);
		}
	});

	it("never shows tokens when an entry is logged or serialized", async () => {
		const id = await connected();
		await waitFor(() => server.mcpIntegrationsCache[id]?.oauth);
		const { tokens } = await storedTokens(stack, id);
		const text = JSON.stringify(server.mcpIntegrationsCache[id]);
		expect(text).not.toContain(tokens!.access_token);
		expect(text).not.toContain(tokens!.refresh_token);
	});
});

describe("refresh", () => {
	it("an expired token is refreshed, saved with a new version, and the cache carries it", async () => {
		const id = await connected();
		const cached = (await waitFor(() => server.mcpIntegrationsCache[id]?.oauth)) as McpOAuth;
		const before = await storedTokens(stack, id);
		math.oauth!.expireAccessTokens();
		expect(await add(cached, 1, 2)).toBe("3");
		const after = await storedTokens(stack, id);
		expect(after.version).toBe(before.version! + 1);
		expect(after.tokens!.refresh_token).not.toBe(before.tokens!.refresh_token);
		// the next job reads the cache: it has the saved tokens, no second refresh
		expect(cached.state().version).toBe(after.version!);
		expect(cached.state().tokens.refresh_token).toBe(after.tokens!.refresh_token);
		const refreshes = math.oauth!.refreshes;
		expect(await add(cached, 2, 2)).toBe("4");
		expect(math.oauth!.refreshes).toBe(refreshes);
	});

	it("two refreshes at once end with one valid token set and both calls succeed", async () => {
		const id = await connected();
		// two processes: each loads its own copy, so only the database can arbitrate
		const [a, b] = [await loadOAuth(id), await loadOAuth(id)];
		math.oauth!.expireAccessTokens();
		const refused = math.oauth!.rejectedRefreshes;
		const [x, y] = await Promise.all([add(a, 1, 1), add(b, 2, 2)]);
		expect([x, y]).toEqual(["2", "4"]);
		// the race really happened: one refresh was refused with the already-rotated token
		expect(math.oauth!.rejectedRefreshes).toBeGreaterThan(refused);

		// what is stored is one set, and it works for a process that loads it fresh
		const stored = await storedTokens(stack, id);
		expect(stored.version).toBeGreaterThan(1);
		const fresh = await loadOAuth(id);
		expect(fresh.state().tokens.refresh_token).toBe(stored.tokens!.refresh_token);
		math.oauth!.expireAccessTokens();
		expect(await add(fresh, 3, 3)).toBe("6");
		// both earlier processes follow the winner's tokens too
		math.oauth!.expireAccessTokens();
		expect(await add(a, 4, 4)).toBe("8");
		expect(await add(b, 5, 5)).toBe("10");
	});

	it("a refresh that lost the write adopts the stored tokens instead of its own", async () => {
		const id = await connected();
		const slow = await loadOAuth(id);
		const from = slow.state();
		const winner = await loadOAuth(id);
		math.oauth!.expireAccessTokens();
		await add(winner, 1, 1);
		const won = await storedTokens(stack, id);
		const tokens = { access_token: "lost-access", refresh_token: "lost-refresh", token_type: "Bearer" };
		const inEffect = await slow.onTokens(tokens, from);
		expect(inEffect.version).toBe(won.version!);
		expect(inEffect.tokens.refresh_token).toBe(won.tokens!.refresh_token);
		expect((await storedTokens(stack, id)).tokens!.refresh_token).toBe(won.tokens!.refresh_token);
	});

	it("with same-as-prod on, a refresh through development writes production's config", async () => {
		const id = await connected({ syncDev: true });
		const dev = await loadOAuth(id, "development");
		const before = await storedTokens(stack, id);
		math.oauth!.expireAccessTokens();
		expect(await add(dev, 7, 7)).toBe("14");
		const after = await storedTokens(stack, id);
		expect(after.version).toBe(before.version! + 1);
		expect(after.tokens!.refresh_token).not.toBe(before.tokens!.refresh_token);
		expect((await storedRow(stack, id)).devConfig).toBeNull();
	});

	it("with its own development connection, development's refresh writes development's config only", async () => {
		const id = await createOAuthIntegration(stack, math, {
			devConfig: { url: math.url, auth: "oauth", headers: [] },
		});
		await connectEnv(stack, id, "production");
		await connectEnv(stack, id, "development");
		const prod = await storedTokens(stack, id);
		const dev = await storedTokens(stack, id, "devConfig");
		math.oauth!.expireAccessTokens();
		expect(await add(await loadOAuth(id, "development"), 1, 5)).toBe("6");
		expect((await storedTokens(stack, id)).version).toBe(prod.version!);
		expect((await storedTokens(stack, id, "devConfig")).version).toBe(dev.version! + 1);
	});
});

describe("disconnect", () => {
	it("makes calls fail with a clear not-connected message", async () => {
		const id = await connected();
		const held = await loadOAuth(id);
		await waitFor(() => server.mcpIntegrationsCache[id]?.oauth);
		const res = await req(stack.s, `${api(stack.projectId)}/${id}/mcp-oauth/disconnect`, {
			cookie: stack.admin,
			json: { env: "production" },
		});
		expect(res.status).toBe(200);

		// a new job: the cache no longer holds a connection
		await waitFor(() => server.mcpIntegrationsCache[id] && !server.mcpIntegrationsCache[id].oauth);
		const { openServers } = await import("./external");
		const [opened] = await openServers([{ id, ...server.mcpIntegrationsCache[id] } as never]);
		expect(opened.error).toContain("Not connected");

		// a job that was already running, with tokens it still holds
		math.oauth!.expireAccessTokens();
		const error = await add(held, 1, 1).catch((e: Error) => e);
		expect(error).toBeInstanceOf(McpNotConnectedError);
	});
});

// MCP OAuth (#824) through the real admin API, Postgres and Redis: Connect, the callback,
// Disconnect, who may do them, and that no response ever carries a token. The agent's use
// of the tokens (refresh, concurrency) is in mcpOAuthRefresh.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";
import { req, stopAuthServer } from "../mcp/tests/authHarness";
import {
	api,
	connectEnv,
	createOAuthIntegration,
	type Math,
	type Stack,
	startConnect,
	startStack,
	storedRow,
	storedTokens,
} from "./mcpOAuthHarness";

let stack: Stack;
let math: Math;

beforeAll(async () => {
	[stack, math] = await Promise.all([startStack(), startMathMcp({ oauth: { accessTtlMs: 60_000 } })]);
}, 300_000);

afterAll(async () => {
	await math?.close();
	// the compile worker is still acknowledging the saves; closing NATS under it is an unhandled error
	await Bun.sleep(1500);
	await stopAuthServer();
});

const get = (path: string, cookie = stack.admin) => req(stack.s, path, { cookie });
const post = (path: string, json: object, cookie = stack.admin) => req(stack.s, path, { cookie, json });
const base = () => api(stack.projectId);

describe("connect and callback", () => {
	it("registers once, stores the tokens encrypted and shows only a status", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		expect(((await (await get(`${base()}/${id}`)).json()) as any).config.oauth).toBeUndefined();

		await connectEnv(stack, id, "production");
		expect(math.oauth!.registrations).toBeGreaterThan(0);

		const row = await storedRow(stack, id);
		expect(row.config.oauth.tokens).toBeString();
		expect(row.config.oauth.tokens).not.toContain("at_");
		const { tokens } = await storedTokens(stack, id);
		expect(tokens!.access_token).toStartWith("at_");

		const read = (await (await get(`${base()}/${id}`)).json()) as any;
		expect(read.config.oauth).toEqual({
			connected: true,
			expiresAt: expect.any(Number),
			scope: "math",
		});

		// a second Connect reuses the registered client
		const registered = math.oauth!.registrations;
		await connectEnv(stack, id, "production");
		expect(math.oauth!.registrations).toBe(registered);
	});

	it("dev and prod connect separately", async () => {
		const id = await createOAuthIntegration(stack, math, {
			devConfig: { url: math.url, auth: "oauth", headers: [] },
		});
		await connectEnv(stack, id, "production");
		const row = await storedRow(stack, id);
		expect(row.config.oauth.tokens).toBeString();
		expect(row.devConfig.oauth).toBeUndefined();
		const read = (await (await get(`${base()}/${id}`)).json()) as any;
		expect(read.config.oauth.connected).toBe(true);
		expect(read.devConfig.oauth).toBeUndefined();

		await connectEnv(stack, id, "development");
		expect((await storedRow(stack, id)).devConfig.oauth.tokens).toBeString();
	});

	it("with same-as-prod on, connecting development is refused: it uses production's", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		const res = await post(`${base()}/${id}/mcp-oauth/connect`, { env: "development" });
		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain("production");
	});

	it("a server without OAuth fails with one short message, not its error page", async () => {
		// answers every address, the OAuth discovery ones too, with a big HTML page
		const page = `<!DOCTYPE html><html><body>${"<p>Not the JSON you were looking for</p>".repeat(200)}</body></html>`;
		const html = Bun.serve({
			port: 0,
			fetch: () => new Response(page, { headers: { "content-type": "text/html" } }),
		});
		try {
			const plain = await startMathMcp();
			for (const url of [`http://127.0.0.1:${html.port}/mcp`, plain.url, "http://127.0.0.1:1/mcp"]) {
				const res = await post(base(), {
					name: `plain-${crypto.randomUUID().slice(0, 8)}`,
					group: "mcp",
					variant: "http",
					config: { url, auth: "oauth", headers: [] },
					syncDev: true,
				});
				const { id } = (await res.json()) as { id: string };
				const connect = await post(`${base()}/${id}/mcp-oauth/connect`, { env: "production" });
				expect(connect.status).toBe(400);
				const text = JSON.stringify(await connect.json());
				expect(text).toContain("Failed to connect");
				expect(text).toContain("may not support OAuth");
				expect(text).not.toContain("<");
				expect(text.length).toBeLessThan(200);
			}
			await plain.close();
		} finally {
			html.stop(true);
		}
	});

	it("needs OAuth switched on and saved first", async () => {
		const res = await post(base(), {
			name: `headers-${crypto.randomUUID().slice(0, 8)}`,
			group: "mcp",
			variant: "http",
			config: { url: math.url, headers: [] },
			syncDev: true,
		});
		const { id } = (await res.json()) as { id: string };
		expect((await post(`${base()}/${id}/mcp-oauth/connect`, { env: "production" })).status).toBe(400);
	});
});

describe("the state", () => {
	it("is single use", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		const callback = await startConnect(stack, id, "production");
		expect((await get(callback)).status).toBe(302);
		const again = await get(callback);
		expect(again.status).toBe(400);
		expect(JSON.stringify(await again.json())).toContain("already used");
	});

	it("is refused for another user, and then cannot be used by its owner either", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		const callback = await startConnect(stack, id, "production");
		expect((await get(callback, stack.admin2)).status).toBe(403);
		expect((await get(callback)).status).toBe(400);
		expect((await storedTokens(stack, id)).tokens).toBeUndefined();
	});

	it("is refused for another project", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		const callback = await startConnect(stack, id, "production");
		const foreign = callback.replace(stack.projectId, stack.otherProjectId);
		expect((await get(foreign, stack.otherAdmin)).status).toBe(403);
		expect((await storedTokens(stack, id)).tokens).toBeUndefined();
	});

	it("an invented state is refused", async () => {
		const res = await get(`${base()}/mcp-oauth/callback?state=nope&code=x`);
		expect(res.status).toBe(400);
	});
});

describe("who may", () => {
	it("a creator gets 403 on Connect, the callback and Disconnect", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		await connectEnv(stack, id, "production");
		const body = { env: "production" };
		expect((await post(`${base()}/${id}/mcp-oauth/connect`, body, stack.creator)).status).toBe(403);
		expect((await post(`${base()}/${id}/mcp-oauth/disconnect`, body, stack.creator)).status).toBe(403);
		expect((await get(`${base()}/mcp-oauth/callback?state=x&code=y`, stack.creator)).status).toBe(403);
		// untouched, and they still see the status
		const read = (await (await get(`${base()}/${id}`, stack.creator)).json()) as any;
		expect(read.config.oauth.connected).toBe(true);
	});
});

describe("disconnect", () => {
	it("clears the environment's oauth and says so", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		await connectEnv(stack, id, "production");
		const res = await post(`${base()}/${id}/mcp-oauth/disconnect`, { env: "production" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ connected: false });
		expect((await storedRow(stack, id)).config.oauth).toBeUndefined();
		const read = (await (await get(`${base()}/${id}`)).json()) as any;
		expect(read.config.oauth).toBeUndefined();
	});
});

describe("no read ever returns a token", () => {
	it("get-by-id, list, list-basic, update and test connection", async () => {
		const id = await createOAuthIntegration(stack, math, {
			devConfig: { url: math.url, auth: "oauth", headers: [] },
		});
		await connectEnv(stack, id, "production");
		await connectEnv(stack, id, "development");
		const pairs = [await storedTokens(stack, id), await storedTokens(stack, id, "devConfig")];
		const secrets: string[] = pairs.flatMap((p) => [p.tokens!.access_token, p.tokens!.refresh_token]);
		const config = { url: math.url, auth: "oauth", headers: [] };
		const responses = [
			await get(`${base()}/${id}`),
			await get(`${base()}/${id}`, stack.creator),
			await get(`${base()}/list/mcp`),
			await get(`${base()}/list/mcp`, stack.creator),
			await get(`${base()}/list-basic`),
			await get(`${base()}/${id}/metadata`),
			await get(`${base()}/test-existing-connection/${id}`),
			await req(stack.s, `${base()}/${id}`, {
				method: "PUT",
				cookie: stack.admin,
				json: { name: "renamed", config, devConfig: config },
			}),
		];
		for (const res of responses) {
			const text = await res.text();
			for (const secret of secrets) expect(text).not.toContain(secret);
			expect(text).not.toContain("refresh_token");
			expect(text).not.toContain("access_token");
			expect(text).not.toContain("client_id");
		}
		// the ones that carry a config say connected, nothing more
		expect(responses[0].status).toBe(200);
		expect(responses[1].status).toBe(200);
		expect(responses[2].status).toBe(200);
		// test connection used the stored sign in
		expect(responses[6].status).toBe(200);
	});
});

describe("updating keeps the connection", () => {
	const put = (id: string, config: object, devConfig?: object | null) =>
		req(stack.s, `${base()}/${id}`, {
			method: "PUT",
			cookie: stack.admin,
			json: { name: `same-${crypto.randomUUID().slice(0, 8)}`, config, ...(devConfig === undefined ? {} : { devConfig }) },
		});

	it("a normal update, even one that sends the status back, never wipes or overwrites it", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		await connectEnv(stack, id, "production");
		const before = await storedTokens(stack, id);
		const sent = { url: math.url, auth: "oauth", headers: [], oauth: { connected: false, tokens: "forged" } };
		expect((await put(id, sent)).status).toBe(200);
		expect(await storedTokens(stack, id)).toEqual(before);
		// leaving `auth` out is not a switch to headers
		expect((await put(id, { url: math.url, headers: [] })).status).toBe(200);
		expect(await storedTokens(stack, id)).toEqual(before);
	});

	it("another server or switching to headers ends the connection", async () => {
		const id = await createOAuthIntegration(stack, math, { syncDev: true });
		await connectEnv(stack, id, "production");
		expect((await put(id, { url: `${math.url}?x=1`, auth: "oauth", headers: [] })).status).toBe(200);
		expect((await storedRow(stack, id)).config.oauth).toBeUndefined();

		await put(id, { url: math.url, auth: "oauth", headers: [] });
		await connectEnv(stack, id, "production");
		expect((await put(id, { url: math.url, auth: "headers", headers: [] })).status).toBe(200);
		expect((await storedRow(stack, id)).config.oauth).toBeUndefined();
	});
});

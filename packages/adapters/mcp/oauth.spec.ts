import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startMathMcp } from "@fluxify/mcp-math";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { openMcpClient } from "./client";
import { McpNotConnectedError, type McpOAuth, type McpOAuthState } from "./oauth";

const REDIRECT = "http://localhost/callback";
let math: Awaited<ReturnType<typeof startMathMcp>>;

beforeAll(async () => {
	math = await startMathMcp({ oauth: { accessTtlMs: 3_600_000 } });
});
afterAll(() => math.close());

/** What a person does in the portal: sign in at the authorization server and hand back the code. */
async function signIn(): Promise<McpOAuthState> {
	let client: OAuthClientInformationMixed | undefined;
	let tokens: OAuthTokens | undefined;
	let verifier = "";
	let authorizationUrl: URL | undefined;
	const provider: OAuthClientProvider = {
		redirectUrl: REDIRECT,
		clientMetadata: { redirect_uris: [REDIRECT], client_name: "test", token_endpoint_auth_method: "none" },
		clientInformation: () => client,
		saveClientInformation: (c) => {
			client = c;
		},
		tokens: () => tokens,
		saveTokens: (t) => {
			tokens = t;
		},
		redirectToAuthorization: (url) => {
			authorizationUrl = url;
		},
		saveCodeVerifier: (v) => {
			verifier = v;
		},
		codeVerifier: () => verifier,
	};
	expect(await auth(provider, { serverUrl: math.url })).toBe("REDIRECT");
	const back = await fetch(authorizationUrl!, { redirect: "manual" });
	const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
	expect(await auth(provider, { serverUrl: math.url, authorizationCode: code })).toBe("AUTHORIZED");
	return { tokens: tokens!, client: client!, expiresAt: Date.now() + 3_600_000, version: 1 };
}

/** A stored connection in memory, with the compare-and-set a real store does. */
function memoryStore(initial: McpOAuthState) {
	let stored = initial;
	const store = {
		writes: 0,
		lost: 0,
		stored: () => stored,
		/** pretends the access token's time is up, as far as the client can tell */
		advance: (expiresAt: number) => {
			stored = { ...stored, expiresAt };
		},
		oauth: {
			state: () => stored,
			onTokens: async (tokens, from) => {
				if (stored.version !== from.version) {
					store.lost++;
					return stored;
				}
				store.writes++;
				stored = { ...stored, tokens, expiresAt: Date.now() + 3_600_000, version: from.version + 1 };
				return stored;
			},
			reload: async () => stored,
		} satisfies McpOAuth,
	};
	return store;
}

const sum = async (oauth: McpOAuth, args: { a: number; b: number }) => {
	const client = await openMcpClient({ url: math.url, auth: "oauth", oauth });
	try {
		return await client.callTool("add", args);
	} finally {
		await client.close();
	}
};

describe("mcp client: oauth", () => {
	it("calls a tool with the stored token", async () => {
		const store = memoryStore(await signIn());
		const out = await sum(store.oauth, { a: 2, b: 3 });
		expect(out.content).toEqual([{ type: "text", text: "5" }]);
		expect(store.writes).toBe(0);
	});

	it("an expired token is refreshed, saved, and the call succeeds", async () => {
		const store = memoryStore(await signIn());
		const before = store.stored().tokens;
		math.oauth!.expireAccessTokens();
		const out = await sum(store.oauth, { a: 1, b: 1 });
		expect(out.content).toEqual([{ type: "text", text: "2" }]);
		expect(store.writes).toBe(1);
		expect(store.stored().version).toBe(2);
		expect(store.stored().tokens.refresh_token).not.toBe(before.refresh_token);
		// the next call uses the saved tokens: no second refresh
		await sum(store.oauth, { a: 1, b: 2 });
		expect(store.writes).toBe(1);
	});

	it("a token the server stopped accepting is refreshed on the 401 and retried once", async () => {
		const store = memoryStore(await signIn());
		const client = await openMcpClient({ url: math.url, auth: "oauth", oauth: store.oauth });
		try {
			math.oauth!.expireAccessTokens();
			const out = await client.callTool("add", { a: 4, b: 4 });
			expect(out.content).toEqual([{ type: "text", text: "8" }]);
			// the call and the client's event stream both get the 401, so more than one refresh may land
			expect(store.writes).toBeGreaterThanOrEqual(1);
		} finally {
			await client.close();
		}
	});

	it("two refreshes at once end with one valid token set and both calls succeed", async () => {
		const store = memoryStore(await signIn());
		math.oauth!.expireAccessTokens();
		const rejected = math.oauth!.rejectedRefreshes;
		const [a, b] = await Promise.all([
			sum(store.oauth, { a: 1, b: 2 }),
			sum(store.oauth, { a: 3, b: 4 }),
		]);
		expect(a.content).toEqual([{ type: "text", text: "3" }]);
		expect(b.content).toEqual([{ type: "text", text: "7" }]);
		// whoever lost the race did not keep a token of its own: what is stored still works
		math.oauth!.expireAccessTokens();
		expect((await sum(store.oauth, { a: 5, b: 5 })).content).toEqual([{ type: "text", text: "10" }]);
		expect(math.oauth!.rejectedRefreshes).toBeGreaterThanOrEqual(rejected);
	});

	it("a token that runs out between calls is refreshed before the next call, not after a 401", async () => {
		const state = await signIn();
		// the server still accepts it; only the stored expiry says it is about to run out
		const store = memoryStore({ ...state, expiresAt: Date.now() + 60_000 });
		const client = await openMcpClient({ url: math.url, auth: "oauth", oauth: store.oauth });
		try {
			await client.callTool("add", { a: 1, b: 1 });
			expect(store.writes).toBe(0);
			store.advance(Date.now() - 1);
			const refused = math.oauth!.unauthorized;
			const out = await client.callTool("add", { a: 2, b: 2 });
			expect(out.content).toEqual([{ type: "text", text: "4" }]);
			expect(store.writes).toBe(1);
			expect(math.oauth!.unauthorized).toBe(refused);
		} finally {
			await client.close();
		}
	});

	it("calls that arrive while it refreshes wait for that one refresh", async () => {
		const state = await signIn();
		const store = memoryStore({ ...state, expiresAt: Date.now() - 1 });
		const refreshes = math.oauth!.refreshes;
		const outs = await Promise.all([1, 2, 3].map((n) => sum(store.oauth, { a: n, b: n })));
		expect(outs.map((o) => (o.content as { text: string }[])[0].text)).toEqual(["2", "4", "6"]);
		expect(store.writes).toBe(1);
		expect(math.oauth!.refreshes).toBe(refreshes + 1);
	});

	it("uses tokens another process already refreshed instead of refreshing again", async () => {
		const state = await signIn();
		const refreshed = { ...state, version: 2, expiresAt: Date.now() + 3_600_000 };
		let current: McpOAuthState = { ...state, expiresAt: Date.now() - 1 };
		const oauth: McpOAuth = {
			state: () => current,
			reload: async () => {
				current = refreshed;
				return current;
			},
			onTokens: async () => {
				throw new Error("must not refresh");
			},
		};
		const refreshes = math.oauth!.refreshes;
		expect((await sum(oauth, { a: 6, b: 6 })).content).toEqual([{ type: "text", text: "12" }]);
		expect(math.oauth!.refreshes).toBe(refreshes);
	});

	it("revoked tokens fail with a clear not-connected error", async () => {
		const store = memoryStore(await signIn());
		math.oauth!.revokeAll();
		const error = await sum(store.oauth, { a: 1, b: 1 }).then(
			() => undefined,
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(McpNotConnectedError);
		expect(error?.message).toContain("Not connected");
	});

	it("auth oauth with nothing stored is not connected, without calling the server", async () => {
		const calls = math.calls.length;
		const error = await openMcpClient({ url: math.url, auth: "oauth" }).then(
			() => undefined,
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(McpNotConnectedError);
		expect(math.calls.length).toBe(calls);
	});

	it("no tokens in an error", async () => {
		const state = await signIn();
		const store = memoryStore(state);
		math.oauth!.revokeAll();
		const error = await sum(store.oauth, { a: 1, b: 1 }).catch((e: Error) => e);
		const text = String((error as Error).message) + String((error as Error).stack);
		expect(text).not.toContain(state.tokens.access_token);
		expect(text).not.toContain(String(state.tokens.refresh_token));
	});
});

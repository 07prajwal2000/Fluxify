import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { AGENT_TOKEN_PREFIX, mintAgentToken, verifyAgentToken } from "../../lib/agentToken";
import * as authModule from "../../lib/auth";
import * as repo from "../../lib/bearerAuthRepository";
import * as env from "../../lib/env";
import { setSession } from "../session";

// spyOn, not mock.module: module mocks leak into every other spec in the run.
const ORIGIN = "http://fluxify.test";
const SECRET = "test-secret-for-agent-tokens";
const ENV: Record<string, string> = { SERVER_URL: ORIGIN, BETTER_AUTH_URL: ORIGIN };
const savedSecret = process.env.BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_SECRET = SECRET;
const envSpy = spyOn(env, "getEnv").mockImplementation((key) => ENV[key as string]);
authModule.initializeAuth({} as never);
const api = authModule.auth.api;
const realVerifyApiKey = api.verifyApiKey;
const spies = [
	envSpy,
	spyOn(api, "getSession").mockResolvedValue(null as never),
	spyOn(api, "verifyApiKey"),
	spyOn(api, "getJwks"),
	spyOn(repo, "isOAuthGrantActive"),
	spyOn(repo, "findTokenUser"),
	spyOn(authModule, "getUserAccessControls"),
];
const [, getSession, verifyApiKey, getJwks, grantActive, findTokenUser, getAcl] = spies as any[];
afterAll(() => {
	for (const spy of spies) spy.mockRestore();
	process.env.BETTER_AUTH_SECRET = savedSecret;
});

const USER = { id: "u1", email: "v@test.local", banned: false, isSystemAdmin: false };
const ACL = [{ projectId: "p1", role: "viewer" }];
const MCP = `${ORIGIN}/_/admin/mcp`;
const ISSUER = `${ORIGIN}/_/admin/api/auth`;

// An ES256 key standing in for the jwt plugin's signing key.
let privateKey: CryptoKey;
const b64 = (data: string | ArrayBuffer) => Buffer.from(data as never).toString("base64url");
async function sign(claims: Record<string, unknown>, key = privateKey) {
	const now = Math.floor(Date.now() / 1000);
	const header = b64(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" }));
	const body = b64(
		JSON.stringify({ sub: "u1", azp: "client1", iss: ISSUER, aud: MCP, iat: now, exp: now + 3600, ...claims }),
	);
	const sig = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(`${header}.${body}`),
	);
	return `${header}.${body}.${b64(sig)}`;
}
const newKeyPair = () =>
	crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

beforeAll(async () => {
	const pair = await newKeyPair();
	privateKey = pair.privateKey;
	const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
	getJwks.mockResolvedValue({ keys: [{ ...jwk, kid: "k1", alg: "ES256" }] });
});

beforeEach(() => {
	for (const spy of [verifyApiKey, grantActive, findTokenUser, getAcl]) spy.mockReset();
	findTokenUser.mockResolvedValue(USER);
	getAcl.mockResolvedValue(ACL);
	grantActive.mockResolvedValue(true);
});

async function run(authorization?: string) {
	const vars: Record<string, any> = {};
	const c = {
		req: { raw: new Request(ORIGIN, { headers: authorization ? { authorization } : {} }) },
		set: (k: string, v: unknown) => {
			vars[k] = v;
		},
	};
	await setSession(c as never, async () => {});
	return vars;
}

describe("setSession bearer fallback", () => {
	it("keeps the cookie session when there is one", async () => {
		getSession.mockResolvedValueOnce({ user: USER, session: { id: "s" }, acl: ACL });
		const vars = await run("Bearer flx_whatever");
		expect(vars.session).toEqual({ id: "s" });
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it("no header means no user", async () => {
		expect(await run()).toEqual({ user: null, session: null, acl: null });
	});

	it("an API key resolves to its owner and their ACL", async () => {
		verifyApiKey.mockResolvedValue({ valid: true, key: { id: "k", referenceId: "u1", expiresAt: null } });
		const vars = await run("Bearer flx_abc");
		expect(verifyApiKey).toHaveBeenCalledWith({ body: { key: "flx_abc" } });
		expect(vars.user).toEqual(USER);
		expect(vars.acl).toEqual(ACL);
		expect(vars.session.userId).toBe("u1");
		expect(getAcl.mock.calls[0].slice(1)).toEqual(["u1", false]);
	});

	it("a bad, expired or revoked API key gives no user", async () => {
		verifyApiKey.mockResolvedValue({ valid: false, key: null });
		expect((await run("Bearer flx_bad")).user).toBeNull();
	});

	it("an OAuth token for the MCP audience resolves to its user and ACL", async () => {
		const vars = await run(`Bearer ${await sign({})}`);
		expect(grantActive).toHaveBeenCalledWith("client1", "u1");
		expect(vars.user).toEqual(USER);
		expect(vars.acl).toEqual(ACL);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it("an expired OAuth token gives no user", async () => {
		const now = Math.floor(Date.now() / 1000);
		expect((await run(`Bearer ${await sign({ exp: now - 60 })}`)).user).toBeNull();
	});

	it("a token for another audience or issuer gives no user", async () => {
		expect((await run(`Bearer ${await sign({ aud: ISSUER })}`)).user).toBeNull();
		expect((await run(`Bearer ${await sign({ iss: "http://evil.test" })}`)).user).toBeNull();
	});

	it("a token signed with another key gives no user", async () => {
		const other = await newKeyPair();
		expect((await run(`Bearer ${await sign({}, other.privateKey)}`)).user).toBeNull();
		expect((await run("Bearer garbage")).user).toBeNull();
	});

	it("a revoked grant or a deleted or banned user gives no user", async () => {
		const token = await sign({});
		grantActive.mockResolvedValueOnce(false);
		expect((await run(`Bearer ${token}`)).user).toBeNull();
		findTokenUser.mockResolvedValueOnce(null);
		expect((await run(`Bearer ${token}`)).user).toBeNull();
		findTokenUser.mockResolvedValueOnce({ ...USER, banned: true });
		expect((await run(`Bearer ${token}`)).user).toBeNull();
	});
});


describe("agent run tokens (#646)", () => {
	it("mint and verify round trip until it expires", () => {
		const t = mintAgentToken("u1", "p1", 1000, 5000);
		expect(t.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
		expect(verifyAgentToken(t, 5999)).toEqual({ userId: "u1", projectId: "p1", expiresAt: new Date(6000) });
		expect(verifyAgentToken(t, 6000)).toBeNull();
	});

	it("a forged, tampered or foreign token is refused", () => {
		const t = mintAgentToken("u1", "p1");
		const [payload, sig] = t.slice(AGENT_TOKEN_PREFIX.length).split(".");
		const other = Buffer.from(JSON.stringify({ u: "u2", p: "p1", exp: Date.now() + 1e6 })).toString("base64url");
		expect(verifyAgentToken(`${AGENT_TOKEN_PREFIX}${other}.${sig}`)).toBeNull();
		expect(verifyAgentToken(`${AGENT_TOKEN_PREFIX}${payload}.x${sig.slice(1)}`)).toBeNull();
		expect(verifyAgentToken(`${AGENT_TOKEN_PREFIX}${payload}`)).toBeNull();
		expect(verifyAgentToken("flx_abc")).toBeNull();
		process.env.BETTER_AUTH_SECRET = "another-secret";
		try {
			expect(verifyAgentToken(t)).toBeNull();
		} finally {
			process.env.BETTER_AUTH_SECRET = SECRET;
		}
	});

	it("resolves to the user with only that project's role", async () => {
		getAcl.mockResolvedValue([...ACL, { projectId: "p2", role: "project_admin" }]);
		const vars = await run(`Bearer ${mintAgentToken("u1", "p1")}`);
		expect(vars.user).toEqual(USER);
		expect(vars.acl).toEqual(ACL);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it("a system admin keeps full rights in that project only", async () => {
		findTokenUser.mockResolvedValue({ ...USER, isSystemAdmin: true });
		getAcl.mockResolvedValue([{ projectId: "*", role: "system_admin" }]);
		const vars = await run(`Bearer ${mintAgentToken("u1", "p1")}`);
		expect(vars.user.isSystemAdmin).toBe(false);
		expect(vars.acl).toEqual([{ projectId: "p1", role: "system_admin" }]);
	});

	it("an expired token or a banned user gives no user", async () => {
		expect((await run(`Bearer ${mintAgentToken("u1", "p1", 1000, Date.now() - 2000)}`)).user).toBeNull();
		findTokenUser.mockResolvedValueOnce({ ...USER, banned: true });
		expect((await run(`Bearer ${mintAgentToken("u1", "p1")}`)).user).toBeNull();
	});
});

describe("bad API keys stay out of the error log", () => {
	// The real plugin endpoint, with only the key lookup stubbed.
	async function runRealVerify(findOne: () => Promise<unknown>) {
		const { adapter } = await authModule.auth.$context;
		const lookup = spyOn(adapter, "findOne").mockImplementation(findOne as never);
		const logError = spyOn(console, "error").mockImplementation(() => {});
		verifyApiKey.mockImplementation(realVerifyApiKey);
		try {
			const vars = await run("Bearer flx_not_a_real_key");
			return { user: vars.user, errors: logError.mock.calls };
		} finally {
			lookup.mockRestore();
			logError.mockRestore();
		}
	}

	it("an invalid key logs no error and gives no user", async () => {
		const { user, errors } = await runRealVerify(async () => null);
		expect(user).toBeNull();
		expect(errors).toEqual([]);
	});

	it("a database failure still logs as an error", async () => {
		const { user, errors } = await runRealVerify(async () => {
			throw new Error("database down");
		});
		expect(user).toBeNull();
		expect(errors.length).toBe(1);
		expect(String(errors[0][0])).toContain("Failed to validate API key");
	});
});

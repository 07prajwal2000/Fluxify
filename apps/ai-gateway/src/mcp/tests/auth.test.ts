import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	type AuthServer,
	createProject,
	createUser,
	MCP_RESOURCE,
	ORIGIN,
	pkce,
	REDIRECT_URI,
	req,
	signIn,
	startAuthServer,
	stopAuthServer,
} from "./authHarness";

const AUTH = "/_/admin/api/auth";
let s: AuthServer;
let projectId: string;

beforeAll(async () => {
	s = await startAuthServer();
	projectId = await createProject(s);
}, 300_000);

afterAll(stopAuthServer);

async function registerClient() {
	const res = await req(s, `${AUTH}/oauth2/register`, {
		json: {
			client_name: "Test MCP client",
			redirect_uris: [REDIRECT_URI],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	expect(res.ok).toBe(true);
	return ((await res.json()) as { client_id: string }).client_id;
}

/** Register, sign in, authorize with PKCE, consent. Returns the code. */
async function authorize(cookie: string, clientId: string, challenge: string) {
	const query = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: "openid profile email offline_access",
		state: "st4te",
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: MCP_RESOURCE,
	});
	const res = await req(s, `${AUTH}/oauth2/authorize?${query}`, { cookie });
	expect(res.status).toBe(302);
	const consentUrl = new URL(res.headers.get("location")!, ORIGIN);
	expect(consentUrl.pathname).toBe("/_/admin/ui/oauth/consent");

	const consent = await req(s, `${AUTH}/oauth2/consent`, {
		cookie,
		json: { accept: true, oauth_query: consentUrl.search.slice(1) },
	});
	expect(consent.status).toBe(200);
	const redirect = new URL(((await consent.json()) as { url: string }).url);
	expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
	expect(redirect.searchParams.get("state")).toBe("st4te");
	return redirect.searchParams.get("code")!;
}

function exchange(clientId: string, code: string, verifier: string) {
	return req(s, `${AUTH}/oauth2/token`, {
		form: {
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
			resource: MCP_RESOURCE,
		},
	});
}

function refresh(clientId: string, refreshToken: string) {
	return req(s, `${AUTH}/oauth2/token`, {
		form: {
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: refreshToken,
			resource: MCP_RESOURCE,
		},
	});
}

/** A viewer connects a fresh client and gets an access token. */
async function connect(email: string) {
	const cookie = await signIn(s, email);
	const clientId = await registerClient();
	const { verifier, challenge } = pkce();
	const code = await authorize(cookie, clientId, challenge);
	const res = await exchange(clientId, code, verifier);
	expect(res.status).toBe(200);
	const token = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
	return { cookie, clientId, token };
}

/** GET is allowed for a viewer, PUT needs project_admin. */
async function adminStatuses(auth: { cookie?: string; bearer?: string }) {
	const get = await req(s, `/_/admin/api/v1/projects/${projectId}`, auth);
	const put = await req(s, `/_/admin/api/v1/projects/${projectId}`, {
		...auth,
		method: "PUT",
		json: { name: "renamed" },
	});
	return [get.status, put.status];
}

function mcp(bearer: string | undefined, method: string, params: object = {}) {
	return req(s, "/_/admin/mcp", {
		bearer,
		accept: "application/json, text/event-stream",
		json: { jsonrpc: "2.0", id: 1, method, params },
	});
}

function mcpStatus(bearer?: string) {
	return mcp(bearer, "ping").then((r) => r.status);
}

/** What an MCP client does: initialize, then call `whoami`. */
async function whoami(bearer: string) {
	const init = await mcp(bearer, "initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "auth.test", version: "0" },
	});
	expect(init.status).toBe(200);
	const res = await mcp(bearer, "tools/call", { name: "whoami", arguments: {} });
	expect(res.status).toBe(200);
	const body = (await res.json()) as { result: { content: { text: string }[] } };
	return JSON.parse(body.result.content[0].text);
}

const viewerOf = (user: { id: string; email: string }) => ({
	id: user.id,
	email: user.email,
	isSystemAdmin: false,
	acl: [{ projectId, role: "viewer" }],
});

describe("MCP OAuth", () => {
	it("serves discovery documents at the host root", async () => {
		for (const path of [
			"/.well-known/oauth-authorization-server",
			"/.well-known/oauth-authorization-server/_/admin/api/auth",
		]) {
			const meta = (await (await req(s, path)).json()) as Record<string, unknown>;
			expect(meta.issuer).toBe(`${ORIGIN}${AUTH}`);
			expect(meta.registration_endpoint).toBe(`${ORIGIN}${AUTH}/oauth2/register`);
			expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
		}
		for (const path of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-protected-resource/_/admin/mcp",
		]) {
			const meta = (await (await req(s, path)).json()) as Record<string, unknown>;
			expect(meta.resource).toBe(MCP_RESOURCE);
			expect(meta.authorization_servers).toEqual([`${ORIGIN}${AUTH}`]);
		}
	});

	it("rate-limits client registration per client address", async () => {
		const register = () =>
			req(s, `${AUTH}/oauth2/register`, {
				ip: "203.0.113.9",
				json: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" },
			}).then((r) => r.status);
		const statuses = [];
		for (let i = 0; i < 6; i++) statuses.push(await register());
		expect(statuses.slice(0, 5).every((st) => st === 200)).toBe(true);
		expect(statuses[5]).toBe(429);
	});

	it("401s /_/admin/mcp without a token, pointing at the metadata", async () => {
		const res = await req(s, "/_/admin/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" } });
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/_/admin/mcp"`,
		);
	});

	it("code + PKCE + consent gives a token that acts exactly like the viewer's login", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { cookie, token } = await connect(viewer.email);
		expect(token.expires_in).toBe(3600);
		expect(token.refresh_token).toBeTruthy();

		const viaCookie = await adminStatuses({ cookie });
		expect(viaCookie).toEqual([200, 403]);
		expect(await adminStatuses({ bearer: token.access_token })).toEqual(viaCookie);
		expect(await whoami(token.access_token)).toEqual(viewerOf(viewer));
	});

	it("remembers consent: a second authorize skips the consent page", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { cookie, clientId } = await connect(viewer.email);
		const { challenge } = pkce();
		const query = new URLSearchParams({
			response_type: "code",
			client_id: clientId,
			redirect_uri: REDIRECT_URI,
			scope: "openid profile email offline_access",
			code_challenge: challenge,
			code_challenge_method: "S256",
		});
		const res = await req(s, `${AUTH}/oauth2/authorize?${query}`, { cookie });
		expect(new URL(res.headers.get("location")!, ORIGIN).origin).toBe("http://127.0.0.1:33418");
	});

	it("rejects a wrong PKCE verifier", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const cookie = await signIn(s, viewer.email);
		const clientId = await registerClient();
		const code = await authorize(cookie, clientId, pkce().challenge);
		const res = await exchange(clientId, code, pkce().verifier);
		expect(res.status).toBe(401);
	});

	it("denying consent sends access_denied back to the client", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const cookie = await signIn(s, viewer.email);
		const clientId = await registerClient();
		const query = new URLSearchParams({
			response_type: "code",
			client_id: clientId,
			redirect_uri: REDIRECT_URI,
			code_challenge: pkce().challenge,
			code_challenge_method: "S256",
		});
		const res = await req(s, `${AUTH}/oauth2/authorize?${query}`, { cookie });
		const consentQuery = new URL(res.headers.get("location")!, ORIGIN).search.slice(1);
		const deny = await req(s, `${AUTH}/oauth2/consent`, {
			cookie,
			json: { accept: false, oauth_query: consentQuery },
		});
		const url = new URL(((await deny.json()) as { url: string }).url);
		expect(url.searchParams.get("error")).toBe("access_denied");
	});

	it("revoking the connected app cuts the token off", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { cookie, clientId, token } = await connect(viewer.email);
		const list = await req(s, `${AUTH}/oauth2/get-consents`, { cookie });
		const consents = (await list.json()) as { id: string; clientId: string }[];
		const consent = consents.find((c) => c.clientId === clientId)!;
		const del = await req(s, `${AUTH}/oauth2/delete-consent`, { cookie, json: { id: consent.id } });
		expect(del.status).toBe(200);
		expect(await mcpStatus(token.access_token)).toBe(401);
		expect((await refresh(clientId, token.refresh_token)).status).toBe(400);
	});

	it("a refresh rotates the token, and reusing the old one kills the chain", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { clientId, token } = await connect(viewer.email);
		const res = await refresh(clientId, token.refresh_token);
		expect(res.status).toBe(200);
		const next = (await res.json()) as { access_token: string; refresh_token: string };
		expect(next.refresh_token).not.toBe(token.refresh_token);
		expect(await mcpStatus(next.access_token)).not.toBe(401);

		expect((await refresh(clientId, token.refresh_token)).status).toBe(400);
		expect((await refresh(clientId, next.refresh_token)).status).toBe(400);
	});

	it("an expired, wrong-audience or forged token gets 401", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { clientId, token } = await connect(viewer.email);
		const now = Math.floor(Date.now() / 1000);
		const sign = (payload: Record<string, unknown>) =>
			s.server.auth.api
				.signJWT({
					body: {
						payload: { sub: viewer.id, azp: clientId, iss: `${ORIGIN}${AUTH}`, iat: now - 7200, ...payload },
					},
				})
				.then((r) => r.token);
		expect(await mcpStatus(await sign({ aud: MCP_RESOURCE, exp: now - 60 }))).toBe(401);
		expect(await mcpStatus(await sign({ aud: `${ORIGIN}${AUTH}`, exp: now + 600 }))).toBe(401);
		expect(await mcpStatus(`${token.access_token.slice(0, -4)}AAAA`)).toBe(401);
		expect(await mcpStatus("not-a-token")).toBe(401);
	});

	it("deleting the user kills their tokens and access tokens", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const { cookie, token } = await connect(viewer.email);
		const key = await createApiKey(cookie);
		expect(await mcpStatus(token.access_token)).not.toBe(401);
		expect(await mcpStatus(key)).not.toBe(401);

		const { deleteSystemUser } = await import("@fluxify/server/src/lib/system-users");
		await deleteSystemUser(viewer.id);
		expect(await mcpStatus(token.access_token)).toBe(401);
		expect(await mcpStatus(key)).toBe(401);
		const left = await s.db.execute(
			`select (select count(*) from oauth_consent where user_id = '${viewer.id}')
			      + (select count(*) from oauth_refresh_token where user_id = '${viewer.id}')
			      + (select count(*) from apikey where reference_id = '${viewer.id}') as n`,
		);
		expect(Number((left as unknown as { n: number }[])[0].n)).toBe(0);
	});
});

async function createApiKey(cookie: string, body: Record<string, unknown> = {}) {
	const res = await req(s, `${AUTH}/api-key/create`, { cookie, json: { name: "ci", ...body } });
	expect(res.status).toBe(200);
	const created = (await res.json()) as { key: string };
	expect(created.key.startsWith("flx_")).toBe(true);
	return created.key;
}

describe("Personal access tokens", () => {
	it("work like the owner's login, are listed and can be revoked", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const cookie = await signIn(s, viewer.email);
		const key = await createApiKey(cookie);

		expect(await adminStatuses({ bearer: key })).toEqual(await adminStatuses({ cookie }));
		expect(await whoami(key)).toEqual(viewerOf(viewer));

		const list = (await (await req(s, `${AUTH}/api-key/list`, { cookie })).json()) as {
			apiKeys: { id: string; name: string; expiresAt: string | null; key?: string }[];
		};
		expect(list.apiKeys).toHaveLength(1);
		expect(list.apiKeys[0].name).toBe("ci");
		expect(list.apiKeys[0].expiresAt).toBeTruthy();
		expect(list.apiKeys[0].key).toBeUndefined();

		const del = await req(s, `${AUTH}/api-key/delete`, { cookie, json: { keyId: list.apiKeys[0].id } });
		expect(del.status).toBe(200);
		expect(await mcpStatus(key)).toBe(401);
		expect(await adminStatuses({ bearer: key })).toEqual([403, 403]);
	});

	it("an expired token gets 401", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const key = await createApiKey(await signIn(s, viewer.email));
		await s.db.execute(
			`update apikey set expires_at = now() - interval '1 minute' where reference_id = '${viewer.id}'`,
		);
		expect(await mcpStatus(key)).toBe(401);
	});

	it("an API key cannot call auth endpoints as its owner", async () => {
		const viewer = await createUser(s, "viewer", projectId);
		const key = await createApiKey(await signIn(s, viewer.email));
		const res = await req(s, `${AUTH}/api-key/create`, { bearer: key, json: { name: "escalate" } });
		expect(res.status).toBe(401);
	});
});

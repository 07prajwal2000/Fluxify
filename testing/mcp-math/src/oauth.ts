import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// A tiny in-process OAuth authorization server for the math server's OAuth mode:
// discovery, dynamic client registration, PKCE (S256), short-lived access tokens
// and refresh-token rotation. It approves every authorization at once: there is
// no login screen to drive.

export type OAuthOptions = {
	/** how long an access token lives; short, so a test can see a refresh. Default 60s. */
	accessTtlMs?: number;
};

/** What a test can look at and do to the authorization server. */
export type OAuthControls = {
	registrations: number;
	/** authorization-code exchanges */
	grants: number;
	/** refresh-token exchanges that succeeded */
	refreshes: number;
	/** refresh attempts with a token that was already rotated or never issued */
	rejectedRefreshes: number;
	/** makes every access token issued so far expired (the refresh tokens stay good) */
	expireAccessTokens(): void;
	/** forgets every token: the next call must sign in again */
	revokeAll(): void;
};

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage) {
	let text = "";
	for await (const chunk of req) text += chunk;
	return text;
}

export function createAuthServer(origin: () => string, opts: OAuthOptions = {}) {
	const ttl = opts.accessTtlMs ?? 60_000;
	const clients = new Set<string>();
	const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string }>();
	const access = new Map<string, number>();
	const refresh = new Set<string>();
	const controls: OAuthControls = {
		registrations: 0,
		grants: 0,
		refreshes: 0,
		rejectedRefreshes: 0,
		expireAccessTokens: () => {
			for (const token of access.keys()) access.set(token, 0);
		},
		revokeAll: () => {
			access.clear();
			refresh.clear();
		},
	};

	const issue = () => {
		const accessToken = `at_${randomUUID()}`;
		const refreshToken = `rt_${randomUUID()}`;
		access.set(accessToken, Date.now() + ttl);
		refresh.add(refreshToken);
		return {
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: Math.max(1, Math.round(ttl / 1000)),
			refresh_token: refreshToken,
			scope: "math",
		};
	};

	const token = async (req: IncomingMessage, res: ServerResponse) => {
		const form = new URLSearchParams(await readBody(req));
		const grant = form.get("grant_type");
		if (grant === "authorization_code") {
			const code = codes.get(form.get("code") ?? "");
			codes.delete(form.get("code") ?? "");
			const verifier = form.get("code_verifier") ?? "";
			const challenge = createHash("sha256").update(verifier).digest("base64url");
			if (
				!code ||
				code.challenge !== challenge ||
				code.redirectUri !== form.get("redirect_uri") ||
				code.clientId !== form.get("client_id")
			) {
				return json(res, 400, { error: "invalid_grant" });
			}
			controls.grants++;
			return json(res, 200, issue());
		}
		if (grant === "refresh_token") {
			const presented = form.get("refresh_token") ?? "";
			// rotation: a refresh token works once
			if (!refresh.delete(presented)) {
				controls.rejectedRefreshes++;
				return json(res, 400, { error: "invalid_grant" });
			}
			controls.refreshes++;
			return json(res, 200, issue());
		}
		return json(res, 400, { error: "unsupported_grant_type" });
	};

	/** Serves the authorization server's own endpoints; false when `path` is not one of them. */
	const handle = async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", origin());
		const base = origin();
		switch (url.pathname) {
			case "/.well-known/oauth-protected-resource/mcp":
				json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
				return true;
			case "/.well-known/oauth-authorization-server":
				json(res, 200, {
					issuer: base,
					authorization_endpoint: `${base}/authorize`,
					token_endpoint: `${base}/token`,
					registration_endpoint: `${base}/register`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
				});
				return true;
			case "/register": {
				const metadata = JSON.parse((await readBody(req)) || "{}");
				const clientId = `client_${randomUUID()}`;
				clients.add(clientId);
				controls.registrations++;
				json(res, 201, { ...metadata, client_id: clientId, token_endpoint_auth_method: "none" });
				return true;
			}
			case "/authorize": {
				const q = url.searchParams;
				const clientId = q.get("client_id") ?? "";
				const redirectUri = q.get("redirect_uri") ?? "";
				if (!clients.has(clientId) || !redirectUri || q.get("code_challenge_method") !== "S256") {
					json(res, 400, { error: "invalid_request" });
					return true;
				}
				const code = `code_${randomUUID()}`;
				codes.set(code, { clientId, redirectUri, challenge: q.get("code_challenge") ?? "" });
				const back = new URL(redirectUri);
				back.searchParams.set("code", code);
				if (q.has("state")) back.searchParams.set("state", q.get("state")!);
				res.writeHead(302, { location: back.toString() }).end();
				return true;
			}
			case "/token":
				await token(req, res);
				return true;
			default:
				return false;
		}
	};

	/** Whether the request carries a live access token; answers 401 with the discovery pointer when not. */
	const authorize = (req: IncomingMessage, res: ServerResponse) => {
		const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
		const expiresAt = bearer ? access.get(bearer) : undefined;
		if (expiresAt && expiresAt > Date.now()) return true;
		res.writeHead(401, {
			"content-type": "application/json",
			"www-authenticate": `Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource/mcp"`,
		});
		res.end(JSON.stringify({ error: "invalid_token" }));
		return false;
	};

	return { handle, authorize, controls };
}

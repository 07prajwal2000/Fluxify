import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived bearer token for one agent run (#646): the agent calls the admin
 * API as the user, limited to one project, for about an hour. Signed with
 * BETTER_AUTH_SECRET, so it needs no table and the admin API verifies it alone.
 * `fxa_<payload>.<hmac>`; the payload is base64url JSON `{ u, p, exp }`.
 */
export const AGENT_TOKEN_PREFIX = "fxa_";
export const AGENT_TOKEN_TTL_MS = 60 * 60_000;

export type AgentGrant = { userId: string; projectId: string; expiresAt: Date };

function sign(payload: string) {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required to sign agent tokens");
	return createHmac("sha256", secret).update(`agent-token:${payload}`).digest("base64url");
}

export function mintAgentToken(
	userId: string,
	projectId: string,
	ttlMs = AGENT_TOKEN_TTL_MS,
	now = Date.now(),
) {
	const payload = Buffer.from(
		JSON.stringify({ u: userId, p: projectId, exp: now + ttlMs }),
	).toString("base64url");
	return `${AGENT_TOKEN_PREFIX}${payload}.${sign(payload)}`;
}

/** The grant behind a token, or null when it is malformed, forged or expired. */
export function verifyAgentToken(token: string, now = Date.now()): AgentGrant | null {
	if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
	const [payload, sig, extra] = token.slice(AGENT_TOKEN_PREFIX.length).split(".");
	if (!payload || !sig || extra !== undefined) return null;
	const want = Buffer.from(sign(payload));
	const got = Buffer.from(sig);
	if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
	try {
		const { u, p, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
		if (typeof u !== "string" || typeof p !== "string" || typeof exp !== "number") return null;
		if (exp <= now) return null;
		return { userId: u, projectId: p, expiresAt: new Date(exp) };
	} catch {
		return null;
	}
}

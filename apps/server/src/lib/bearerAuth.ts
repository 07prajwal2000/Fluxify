import { verifyJwsAccessToken } from "better-auth/oauth2";
import { db } from "../db";
import { API_KEY_PREFIX, auth, authIssuerUrl, getUserAccessControls, mcpResourceUrl } from "./auth";
import { findTokenUser, isOAuthGrantActive } from "./bearerAuthRepository";

type Grant = { userId: string; tokenId: string; expiresAt: Date };

/**
 * Turns `Authorization: Bearer <token>` into the same `{ user, session, acl }`
 * a cookie login gets, so every route and service check works unchanged.
 * `flx_…` is a personal access token, anything else an OAuth access token.
 * Returns null for a missing, bad, expired or revoked token.
 */
export async function resolveBearerSession(headers: Headers) {
	const token = headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!token) return null;
	const grant = token.startsWith(API_KEY_PREFIX)
		? await apiKeyGrant(token)
		: await oauthGrant(token);
	return grant ? loadIdentity(grant) : null;
}

async function apiKeyGrant(key: string): Promise<Grant | null> {
	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key) return null;
	return {
		userId: result.key.referenceId,
		tokenId: result.key.id,
		expiresAt: new Date(result.key.expiresAt ?? 8.64e15),
	};
}

async function oauthGrant(token: string): Promise<Grant | null> {
	const payload = await verifyJwsAccessToken(token, {
		jwksFetch: () => auth.api.getJwks(),
		jwksCacheKey: auth,
		// Only tokens minted for the MCP endpoint. A session JWT from /token
		// or a token for another audience is refused here.
		verifyOptions: { audience: mcpResourceUrl(), issuer: authIssuerUrl() },
	}).catch(() => null);
	const userId = payload?.sub;
	const clientId = payload?.azp;
	if (!userId || typeof clientId !== "string" || !payload.exp) return null;
	// A JWT can't be recalled, so the grant behind it is checked instead:
	// revoking the app (deleting its consent), deleting or disabling the
	// client, or deleting the user cuts its tokens off at once.
	if (!(await isOAuthGrantActive(clientId, userId))) return null;
	return { userId, tokenId: payload.jti ?? clientId, expiresAt: new Date(payload.exp * 1000) };
}

async function loadIdentity(grant: Grant) {
	const user = await findTokenUser(grant.userId);
	if (!user || user.banned) return null;
	const now = new Date();
	return {
		user,
		session: {
			id: grant.tokenId,
			userId: grant.userId,
			token: "",
			expiresAt: grant.expiresAt,
			createdAt: now,
			updatedAt: now,
			ipAddress: null,
			userAgent: null,
		},
		acl: await getUserAccessControls(db, grant.userId, user.isSystemAdmin),
	};
}

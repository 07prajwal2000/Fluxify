import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { generateID } from "@fluxify/lib";
import { betterAuth } from "better-auth";
import { type DB, drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, isAPIError } from "better-auth/api";
import { admin, customSession, jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import * as authSchemas from "../db/auth-schema";
import { account, systemUsers } from "../db/auth-schema";
import { deleteCacheKey, getCache, setCache, setCacheEx } from "../db/redis";
import { accessControlEntity } from "../db/schema";
import { ssoOrigins, ssoPlugin } from "./auth.sso.ee";
import { getEnv } from "./env";

export let auth: ReturnType<typeof initializeAuth> = null!;

/** Personal access tokens start with this, so a Bearer token says what it is. */
export const API_KEY_PREFIX = "flx_";

/** The OAuth issuer: where clients find /oauth2/authorize, /oauth2/token, ... */
export function authIssuerUrl() {
	return `${getEnv("SERVER_URL")}/_/admin/api/auth`;
}

/** The MCP endpoint. OAuth access tokens are minted for this audience only. */
export function mcpResourceUrl() {
	return `${getEnv("SERVER_URL")}/_/admin/mcp`;
}

/** Where an MCP client is sent, in a 401, to learn how to sign in. */
export function mcpResourceMetadataUrl() {
	return `${getEnv("SERVER_URL")}/.well-known/oauth-protected-resource/_/admin/mcp`;
}

/**
 * Better Auth's default output, minus one line: the api-key plugin logs every
 * bad, expired or revoked key as an ERROR, so anyone sending junk Bearer keys
 * could flood the logs. That outcome is an APIError (a plain 401); anything
 * else, like the database being down, still logs.
 */
function logAuth(level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) {
	if (message.startsWith("Failed to validate API key") && isAPIError(args[0])) return;
	const write = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
	write(`${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`, ...args);
}

function trustedOrigins() {
	const origins = getEnv("TRUSTED_ORIGINS")
		?.split(",")
		.map((o) => o.trim()) ?? [getEnv("SERVER_URL")!];
	// The configured SSO issuer is inherently trusted (an admin set it); the SSO
	// plugin validates the OIDC discovery endpoint against trustedOrigins, so add
	// the issuer/discovery origin here to allow the discovery fetch.
	origins.push(...ssoOrigins());
	return [...new Set(origins)];
}

export function initializeAuth(db: DB) {
	const _auth = betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: authSchemas,
		}),
		basePath: "/_/admin/api/auth",
		trustedOrigins: trustedOrigins(),
		// Never render Better Auth's built-in error page from the API origin.
		// OAuth/SSO failures instead return to the portal, which owns the
		// user-facing copy for each error code.
		onAPIError: {
			errorURL: `${getEnv("SERVER_URL")!}/_/admin/ui/login`,
		},
		logger: { log: logAuth },
		// OAuth tokens point at the session that granted them, so sessions must
		// be in the database as well as Redis (oauth-provider refuses to start
		// otherwise).
		session: { storeSessionInDatabase: true },
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			requireEmailVerification: false,
		},
		account: {
			accountLinking: {
				enabled: true,
				// Legacy credential users are created by an administrator and do not
				// necessarily have Better Auth's local emailVerified flag set. The
				// configured SSO connection is trusted below and still has to match
				// its verified domain before Better Auth may link its account.
				requireLocalEmailVerified: false,
			},
		},
		databaseHooks: {
			user: {
				create: {
					// Bridge every Better Auth user to the canonical system_users
					// row and share its id (FK target for the cascade delete).
					before: async (userData) => {
						const email = (userData.email ?? "").toLowerCase();
						const existing = await db
							.select({ id: systemUsers.id })
							.from(systemUsers)
							.where(eq(systemUsers.email, email));
						if (existing.length > 0) {
							// pre-created (admin) → reuse its id as the user id
							return { data: { id: existing[0].id } };
						}
						// SSO users must be pre-provisioned in system_users by an administrator.
						throw new APIError("NOT_FOUND", {
							code: "ACCOUNT_NOT_PRE_PROVISIONED",
							// The SSO callback forwards the message in its redirect query, so
							// keep it as the same stable code the portal maps below.
							message: "ACCOUNT_NOT_PRE_PROVISIONED",
						});
					},
				},
			},
		},
		advanced: {
			database: {
				generateId: generateID,
			},
		},
		secondaryStorage: {
			async get(key: string) {
				return getCache(key);
			},
			async set(key: string, value: string, ttl?: number) {
				if (ttl) {
					await setCacheEx(key, value, ttl);
				} else {
					await setCache(key, value);
				}
			},
			async delete(key: string) {
				await deleteCacheKey(key);
			},
		},
		plugins: [
			customSession(async ({ user, session }) => {
				// user.id === system_users.id; isSystemAdmin lives on system_users.
				const [su, userAccount] = await Promise.all([
					db
						.select({ isSystemAdmin: systemUsers.isSystemAdmin })
						.from(systemUsers)
						.where(eq(systemUsers.id, session.userId)),
					db
						.select({ providerId: account.providerId })
						.from(account)
						.where(eq(account.userId, session.userId))
						.limit(1),
				]);
				const isSystemAdmin = su[0]?.isSystemAdmin ?? false;
				const acl = getUserAccessControls(db, session.userId, isSystemAdmin);
				return {
					user: { ...user, isSystemAdmin },
					session,
					providerId: userAccount[0]?.providerId ?? null,
					acl: await acl, // extends session with acl
				};
			}),
			admin(),
			// Enterprise Edition, see `auth.sso.ee.ts`. Registered whatever the
			// license says: only *configuring* SSO is gated, so an instance that
			// lapses never locks out admins who sign in through it.
			ssoPlugin(),
			// Signs OAuth access tokens. No JWT header on get-session: nothing
			// reads it, and it would sign a token on every request.
			jwt({ disableSettingJwtHeader: true, jwt: { issuer: authIssuerUrl() } }),
			// OAuth 2.1 for MCP clients. Registration is open (MCP clients
			// register themselves), so consent is always asked: the plugin
			// rejects `skip_consent` at dynamic registration and remembers each
			// grant per user and client. Login and consent pages are the portal's.
			oauthProvider({
				loginPage: "/_/admin/ui/login",
				consentPage: "/_/admin/ui/oauth/consent",
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
				validAudiences: [mcpResourceUrl()],
				// No client_credentials: every token must belong to a user.
				grantTypes: ["authorization_code", "refresh_token"],
				// The well-known documents are served at the host root (oauthRoutes.ts).
				silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
			}),
			// Personal access tokens. Resolved by setSession, not by Better
			// Auth's API-key sessions, so a token cannot call auth endpoints
			// (mint more tokens, approve OAuth consent) as its owner.
			apiKey({
				defaultPrefix: API_KEY_PREFIX,
				requireName: true,
				// Every token expires: 90 days unless the user picks 1-365.
				keyExpiration: { defaultExpiresIn: 60 * 60 * 24 * 90 },
				// The plugin's default is 10 requests a day per key.
				rateLimit: { enabled: false },
			}),
		],
	});
	auth = _auth;
	return _auth;
}

export async function getUserAccessControls(db: DB, userId: string, isSystemAdmin: boolean) {
	if (isSystemAdmin) {
		return [
			{
				projectId: "*",
				role: "system_admin",
			},
		];
	}
	const userAccessControls = await db
		.select({
			projectId: accessControlEntity.projectId,
			role: accessControlEntity.role,
		})
		.from(accessControlEntity)
		.where(eq(accessControlEntity.userId, userId));
	return userAccessControls;
}

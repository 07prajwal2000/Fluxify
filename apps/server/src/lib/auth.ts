import { generateID } from "@fluxify/lib";
import { betterAuth } from "better-auth";
import { type DB, drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, customSession } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import * as authSchemas from "../db/auth-schema";
import { account, systemUsers } from "../db/auth-schema";
import { deleteCacheKey, getCache, setCache, setCacheEx } from "../db/redis";
import { accessControlEntity } from "../db/schema";
import { ssoOrigins, ssoPlugin } from "./auth.sso.ee";
import { getEnv } from "./env";

export let auth: ReturnType<typeof initializeAuth> = null!;

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
		],
	});
	auth = _auth;
	return _auth;
}

async function getUserAccessControls(db: DB, userId: string, isSystemAdmin: boolean) {
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

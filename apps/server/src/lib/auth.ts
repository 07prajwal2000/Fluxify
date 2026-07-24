import { betterAuth } from "better-auth";
import { DB, drizzleAdapter } from "better-auth/adapters/drizzle";
import { deleteCacheKey, getCache, setCache, setCacheEx } from "../db/redis";
import { accessControlEntity } from "../db/schema";
import { eq } from "drizzle-orm";
import { customSession } from "better-auth/plugins";
import * as authSchemas from "../db/auth-schema";
import { systemUsers } from "../db/auth-schema";
import { admin } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { generateID } from "@fluxify/lib";
import { getSetting } from "../loaders/instanceSettingsLoader";

export let auth: ReturnType<typeof initializeAuth> = null!;

function trustedOrigins() {
	const origins = process.env.TRUSTED_ORIGINS?.split(",").map((o) =>
		o.trim(),
	) ?? [process.env.SERVER_URL!];
	// The configured SSO issuer is inherently trusted (an admin set it); the SSO
	// plugin validates the OIDC discovery endpoint against trustedOrigins, so add
	// the issuer/discovery origin here to allow the discovery fetch.
	const sso = getSetting("sso_config");
	for (const url of [sso?.issuer, sso?.discoveryEndpoint]) {
		if (!url) continue;
		try {
			origins.push(new URL(url).origin);
		} catch {
			/* ignore malformed url */
		}
	}
	return [...new Set(origins)];
}

// Build a single inline SSO provider from instance_settings.sso_config.
// Precedence over any DB providers; we never create the ssoProvider table.
function ssoDefaults(): NonNullable<Parameters<typeof sso>[0]>["defaultSSO"] {
	const cfg = getSetting("sso_config");
	if (!cfg || !cfg.enabled) return [];
	if (cfg.provider === "oidc") {
		return [
			{
				domain: cfg.domain,
				providerId: cfg.providerId,
				oidcConfig: {
					issuer: cfg.issuer,
					clientId: cfg.clientId!,
					clientSecret: cfg.clientSecret!,
					discoveryEndpoint:
						cfg.discoveryEndpoint ??
						`${cfg.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
					pkce: true,
					scopes: cfg.scopes ?? ["openid", "email", "profile"],
				},
			},
		];
	}
	// ponytail: SAML mapped from minimal fields; spMetadata/signing left default,
	// wire fully when a real SAML IdP is onboarded.
	return [
		{
			domain: cfg.domain,
			providerId: cfg.providerId,
			samlConfig: {
				issuer: cfg.issuer,
				entryPoint: cfg.entryPoint!,
				cert: cfg.samlCert!,
				callbackUrl: `${process.env.SERVER_URL!}/_/admin/api/auth/sso/saml2/callback/${cfg.providerId}`,
				spMetadata: { metadata: "" },
			},
		},
	];
}

export function initializeAuth(db: DB) {
	const _auth = betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: authSchemas,
		}),
		basePath: "/_/admin/api/auth",
		trustedOrigins: trustedOrigins(),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			requireEmailVerification: false,
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
						// SSO JIT → create the canonical row first (FK target)
						await db.insert(systemUsers).values({
							id: userData.id,
							email,
							name: userData.name ?? null,
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
				const su = await db
					.select({ isSystemAdmin: systemUsers.isSystemAdmin })
					.from(systemUsers)
					.where(eq(systemUsers.id, session.userId));
				const isSystemAdmin = su[0]?.isSystemAdmin ?? false;
				const acl = getUserAccessControls(db, session.userId, isSystemAdmin);
				return {
					user: { ...user, isSystemAdmin },
					session,
					acl: await acl, // extends session with acl
				};
			}),
			admin(),
			// Single SSO provider loaded from instance_settings.sso_config.
			// Better Auth handles sign-up + account creation/linking automatically.
			sso({
				defaultSSO: ssoDefaults(),
			}),
		],
	});
	auth = _auth;
	return _auth;
}

async function getUserAccessControls(
	db: DB,
	userId: string,
	isSystemAdmin: boolean,
) {
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

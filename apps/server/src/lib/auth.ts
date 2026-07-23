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
	return (
		process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? [
			process.env.SERVER_URL!,
		]
	);
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
    user: {
      additionalFields: {
        isSystemAdmin: {
          type: "boolean",
          defaultValue: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
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
        const acl = await getUserAccessControls(db, session.userId);
        return {
          user,
          session,
          acl, // extends session with acl
        };
      }),
      admin(),
      sso({
        defaultSSO: ssoDefaults(),
        disableImplicitSignUp: true, // no JIT: unknown emails are never provisioned
        providersLimit: 0, // single config comes from instance_settings; no runtime registration
        provisionUser: async ({ userInfo }) => {
          // Explicit no-JIT guard. disableImplicitSignUp already prevents orphan
          // rows; this asserts the pre-provisioned invariant and surfaces the
          // named error if that ever changes.
          const email = userInfo.email;
          const existing = email
            ? await db
                .select({ id: authSchemas.user.id })
                .from(authSchemas.user)
                .where(eq(authSchemas.user.email, email))
            : [];
          if (existing.length === 0) {
            throw new Error("ACCOUNT_NOT_PRE_PROVISIONED");
          }
        },
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

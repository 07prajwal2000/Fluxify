import z from "zod";

/**
 * Per-key registry for the `instance_settings` table.
 * Each key maps to a strict full schema (server-side, may hold secrets) and a
 * `publicSchema` projection that strips secrets — the leak guard for rows with
 * `is_public: true`.
 */

export const ssoConfigSchema = z.object({
	provider: z.enum(["oidc", "saml"]),
	enabled: z.boolean().default(false),
	providerId: z.string().default("enterprise"),
	issuer: z.string().url(),
	domain: z.string(), // e.g. company.com — drives the no-JIT domain check
	// OIDC
	clientId: z.string().optional(),
	clientSecret: z.string().optional(), // SECRET
	discoveryEndpoint: z.string().url().optional(), // defaults to `${issuer}/.well-known/openid-configuration`
	scopes: z.array(z.string()).optional(),
	// SAML (ponytail: minimal fields; expand when a real SAML IdP is onboarded)
	entryPoint: z.string().url().optional(),
	samlCert: z.string().optional(), // SECRET
});

// public projection: no secrets, no endpoints
export const ssoConfigPublicSchema = ssoConfigSchema.pick({
	provider: true,
	enabled: true,
	providerId: true,
	issuer: true,
	domain: true,
});

export const authConfigSchema = z.object({
	mode: z.enum(["traditional", "sso_only"]),
});

export const instanceSettingCategorySchema = z.enum(["auth"]); // mirrors the pgEnum

export const INSTANCE_SETTINGS_REGISTRY = {
	sso_config: {
		category: "auth",
		schema: ssoConfigSchema,
		publicSchema: ssoConfigPublicSchema,
	},
	auth_config: {
		category: "auth",
		schema: authConfigSchema,
		publicSchema: authConfigSchema,
	},
} as const;

export type InstanceSettingKey = keyof typeof INSTANCE_SETTINGS_REGISTRY;

// discriminated key→value map drives the typed nullable getter
export type InstanceSettingValue<K extends InstanceSettingKey> = z.infer<
	(typeof INSTANCE_SETTINGS_REGISTRY)[K]["schema"]
>;

export function isInstanceSettingKey(key: string): key is InstanceSettingKey {
	return key in INSTANCE_SETTINGS_REGISTRY;
}

// ponytail: name-based secret list; add fields as new secret-bearing keys appear.
const SECRET_FIELDS = new Set(["clientSecret", "samlCert", "privateKey"]);

/**
 * Mask secret fields for admin reads. Secrets are write-only: config stays
 * visible/editable but the values are never echoed back. A present secret
 * becomes "••••••" so the UI can show "set" without exposing it.
 */
export function redactSecrets(
	value: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = SECRET_FIELDS.has(k) && v != null && v !== "" ? "••••••" : v;
	}
	return out;
}

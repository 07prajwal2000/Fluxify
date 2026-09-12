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

/** An operator switch. Absent means on — the license, not the switch, is the gate. */
export const featureToggleSchema = z.object({ enabled: z.boolean() });

/**
 * The worker pool's ceiling — the operator's only provisioning knob (§3a).
 *
 * A setting rather than a table of its own: this gets Postgres persistence, the
 * KV fan-out to every process and the boot reconcile for free, and the
 * orchestrator needs to read it without a Postgres round trip on every loop.
 *
 * It is a ceiling, not a target. A claim past it sits `pending` /
 * `pool_unavailable` until the operator grows the pool — the reconciler never
 * forces a container onto the host.
 */
export const orchestrationPoolSchema = z.object({
	/** How many worker containers may exist at once. 0 means the operator has not sized the pool yet. */
	maxNodes: z.number().int().min(0).default(0),
	/** Per-node CPU budget in cores, passed to the container. Unset leaves it to the platform's default. */
	cpuPerNode: z.number().positive().optional(),
	/** Per-node memory budget in MB. Unset leaves it to the platform's default. */
	memoryPerNodeMb: z.number().int().positive().optional(),
});

export const instanceSettingCategorySchema = z.enum([
	"auth",
	"featureflags",
	"orchestration",
]); // mirrors the pgEnum

export const INSTANCE_SETTINGS_REGISTRY = {
	sso_config: {
		category: "auth",
		schema: ssoConfigSchema,
		publicSchema: ssoConfigPublicSchema,
		// the login screen needs provider/enabled/issuer/domain before the user
		// is authenticated; publicSchema already strips secrets, so this is safe.
		alwaysPublic: true,
	},
	auth_config: {
		category: "auth",
		schema: authConfigSchema,
		publicSchema: authConfigSchema,
		alwaysPublic: true,
	},
	// Enterprise flags are named `featureflags.ee.*`, community ones
	// `featureflags.community.*`. Whether the license allows enterprise
	// features at all is not a row here: it comes from LICENSE_KEY and no
	// operator can write it (see `lib/edition.ts`).
	orchestration_pool: {
		category: "orchestration",
		schema: orchestrationPoolSchema,
		publicSchema: orchestrationPoolSchema,
		// the pool ceiling is an operator's business, and nothing pre-auth needs it
		alwaysPublic: false,
	},
	"featureflags.ee.connectors": {
		category: "featureflags",
		schema: featureToggleSchema,
		publicSchema: featureToggleSchema,
		// the portal hides connector types when this is off
		alwaysPublic: true,
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

/**
 * Registry-forced keys (auth_config/sso_config) are always public — the
 * login screen needs them pre-auth, and publicSchema already strips
 * secrets — so no caller can opt them back into private.
 */
export function resolveIsPublic(
	key: string,
	callerIsPublic: boolean | undefined,
	existingIsPublic: boolean | undefined,
): boolean {
	if (isInstanceSettingKey(key) && INSTANCE_SETTINGS_REGISTRY[key].alwaysPublic) {
		return true;
	}
	return callerIsPublic ?? existingIsPublic ?? false;
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

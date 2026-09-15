import { sso } from "@better-auth/sso";
import { getSetting } from "../loaders/instanceSettingsLoader";
import { getEnv } from "./env";

/**
 * Enterprise Edition — see LICENSE_EE.
 *
 * SSO (OIDC and SAML) for `lib/auth.ts`. Everything that knows the SSO plugin
 * exists lives here; `auth.ts` only calls `ssoPlugin()` and `ssoOrigins()`.
 *
 * The plugin is registered unconditionally, whatever the license says. Writing
 * an SSO configuration is what the license gates (`assertCanUse("sso")` in
 * `api/v1/instance-settings/patch-auth-settings`). Removing the plugin from a
 * running `sso_only` instance would lock out every admin who has no password,
 * so a lapsed license makes SSO read-only, never unusable.
 */

/** The configured issuer's origins, which the plugin must be allowed to fetch discovery from. */
export function ssoOrigins() {
	const cfg = getSetting("sso_config");
	const origins: string[] = [];
	for (const url of [cfg?.issuer, cfg?.discoveryEndpoint]) {
		if (!url) continue;
		try {
			origins.push(new URL(url).origin);
		} catch {
			/* ignore malformed url */
		}
	}
	return origins;
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
				callbackUrl: `${getEnv("SERVER_URL")!}/_/admin/api/auth/sso/saml2/callback/${cfg.providerId}`,
				spMetadata: { metadata: "" },
			},
		},
	];
}

/** Single SSO provider loaded from instance_settings.sso_config. */
export function ssoPlugin() {
	return sso({
		defaultSSO: ssoDefaults(),
		// SSO sign-in is limited to users an administrator has already
		// provisioned. This stops Better Auth before it attempts to create a
		// new user/account; the database hook remains a defense in depth.
		disableImplicitSignUp: true,
		// defaultSSO is configured by this instance's administrator rather than
		// end users. Better Auth marks these static providers as domain-verified
		// when this mode is enabled, allowing a same-email SSO identity to be
		// linked to the existing credential account (instead of rejecting it as
		// "account not linked"). No ssoProvider row is used for defaultSSO.
		domainVerification: { enabled: true },
	});
}

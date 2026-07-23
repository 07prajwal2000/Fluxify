import { describe, it, expect } from "bun:test";
import {
	ssoConfigSchema,
	ssoConfigPublicSchema,
	INSTANCE_SETTINGS_REGISTRY,
} from "./schemas";

// The security-critical path: is_public rows must never leak IdP secrets.
describe("instance-settings leak guard", () => {
	const full = ssoConfigSchema.parse({
		provider: "oidc",
		enabled: true,
		issuer: "https://idp.company.com",
		domain: "company.com",
		clientId: "abc",
		clientSecret: "super-secret",
		samlCert: "-----BEGIN CERT-----",
	});

	it("strips clientSecret and samlCert from the public projection", () => {
		const pub = ssoConfigPublicSchema.parse(full) as Record<string, unknown>;
		expect(pub.clientSecret).toBeUndefined();
		expect(pub.samlCert).toBeUndefined();
		expect(pub.clientId).toBeUndefined();
		expect(pub.domain).toBe("company.com"); // non-secret fields survive
	});

	it("every registered key has a publicSchema", () => {
		for (const key of Object.keys(INSTANCE_SETTINGS_REGISTRY)) {
			expect(
				INSTANCE_SETTINGS_REGISTRY[key as keyof typeof INSTANCE_SETTINGS_REGISTRY]
					.publicSchema,
			).toBeDefined();
		}
	});
});

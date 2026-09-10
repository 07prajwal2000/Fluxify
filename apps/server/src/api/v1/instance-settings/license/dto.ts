import z from "zod";

export const setLicenseBodySchema = z.discriminatedUnion("edition", [
	z.object({ edition: z.literal("community") }),
	z.object({
		edition: z.literal("non_commercial"),
		/** Use is personal, education, or non-profit. */
		confirmNonCommercial: z.literal(true),
	}),
	z.object({ edition: z.literal("enterprise"), key: z.string().trim().min(1) }),
]);

export const licenseViewSchema = z.object({
	/** Where the key comes from. `env` wins and makes the license read-only here. */
	source: z.enum(["env", "ui", "default"]),
	edition: z.enum(["community", "non_commercial", "enterprise"]),
	status: z.enum(["community", "non_commercial", "active", "expired", "invalid"]),
	/** Why the configured key does not verify; the instance runs as community meanwhile. */
	invalidReason: z.string().nullable(),
	licensee: z.string().nullable(),
	expiresAt: z.string().nullable(),
	graceEndsAt: z.string().nullable(),
	daysRemaining: z.number().nullable(),
	features: z.array(z.string()),
	/** A short hash of the key, so two keys can be told apart. The key itself is never returned. */
	fingerprint: z.string().nullable(),
	connectorsSwitchedOff: z.boolean(),
	confirmedBy: z.object({ name: z.string().nullable(), email: z.string() }).nullable(),
	confirmedAt: z.string().nullable(),
});

export type LicenseView = z.infer<typeof licenseViewSchema>;

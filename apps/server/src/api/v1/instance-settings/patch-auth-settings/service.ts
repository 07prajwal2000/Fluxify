import { BadRequestError } from "../../../../errors/badRequestError";
import { ssoConfigSchema, redactSecrets } from "../../../../lib/instance-settings/schemas";
import { getInstanceSettingByKey, upsertInstanceSetting } from "../upsert/repository";
import { publishInstanceSetting } from "../../../../loaders/instanceSettingsLoader";

export interface AuthSettingsPayload {
	type: "traditional" | "sso";
	sso_config?: Record<string, unknown>;
}

function formatIssues(error: import("zod").ZodError) {
	return error.issues
		.map((e) => `${e.path.join(".") || "value"}: ${e.message}`)
		.join("; ");
}

function requireProviderFields(sso: ReturnType<typeof ssoConfigSchema.parse>) {
	if (sso.provider === "oidc") {
		if (!sso.clientId?.trim() || !sso.clientSecret?.trim()) {
			throw new BadRequestError(
				"Authentication type 'sso' requires 'clientId' and 'clientSecret' for the OIDC provider.",
			);
		}
	} else if (sso.provider === "saml") {
		if (!sso.entryPoint?.trim() || !sso.samlCert?.trim()) {
			throw new BadRequestError(
				"Authentication type 'sso' requires 'entryPoint' and 'samlCert' for the SAML provider.",
			);
		}
	}
}

export default async function handleRequest(payload: AuthSettingsPayload) {
	const { type, sso_config: ssoPatch } = payload;
	const wantsSso = type === "sso";
	const hasPatch = !!ssoPatch && Object.keys(ssoPatch).length > 0;

	const existingSsoRow = await getInstanceSettingByKey("sso_config");
	let ssoValue = (existingSsoRow?.value as Record<string, unknown>) ?? {};

	// Only touch sso_config when there's something to merge or the row already
	// exists — switching to 'traditional' with no prior SSO setup is a no-op.
	if (wantsSso || hasPatch || existingSsoRow) {
		const merged = { ...ssoValue, ...ssoPatch, enabled: wantsSso };
		const parsed = ssoConfigSchema.safeParse(merged);

		if (!parsed.success) {
			if (wantsSso || hasPatch) {
				throw new BadRequestError(
					`Validation failed for SSO configuration: ${formatIssues(parsed.error)}`,
				);
			}
			// disabling, no patch, and the stored config was already incomplete — leave it alone
		} else {
			if (wantsSso) requireProviderFields(parsed.data);
			const updated = await upsertInstanceSetting({
				key: "sso_config",
				category: "auth",
				value: parsed.data,
			});
			ssoValue = updated.value as Record<string, unknown>;
			await publishInstanceSetting("sso_config", updated.value, updated.isPublic);
		}
	}

	const authConfig = await upsertInstanceSetting({
		key: "auth_config",
		category: "auth",
		value: { mode: wantsSso ? "sso_only" : "traditional" },
	});

	// Each key is published on its own now — KV is per-key, so there is no
	// "reload everything" signal to piggyback the sso_config change on.
	await publishInstanceSetting("auth_config", authConfig.value, authConfig.isPublic);

	return {
		message: "Authentication settings saved successfully",
		type,
		sso_config: redactSecrets(ssoValue),
	};
}

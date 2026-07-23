import { BadRequestError } from "../../../../errors/badRequestError";
import {
	INSTANCE_SETTINGS_REGISTRY,
	isInstanceSettingKey,
	ssoConfigSchema,
	authConfigSchema,
} from "../../../../lib/instance-settings/schemas";
import { getInstanceSettingByKey, upsertInstanceSetting } from "./repository";
import { CHAN_ON_INSTANCE_SETTING_CHANGE, publishMessage } from "../../../../db/redis";

export interface UpsertSettingPayload {
	key: string;
	value: Record<string, unknown>;
	category?: string;
	isPublic?: boolean;
}

export default async function handleRequest(payload: UpsertSettingPayload) {
	const { key, value, category: inputCategory, isPublic } = payload;

	if (!isInstanceSettingKey(key)) {
		throw new BadRequestError(
			`Invalid or unregistered instance setting key: '${key}'. Valid keys are: ${Object.keys(
				INSTANCE_SETTINGS_REGISTRY,
			).join(", ")}`,
		);
	}

	const registryItem = INSTANCE_SETTINGS_REGISTRY[key];
	const category = inputCategory ?? registryItem.category;

	if (inputCategory && inputCategory !== registryItem.category) {
		throw new BadRequestError(
			`Invalid category '${inputCategory}' for setting '${key}'. Expected '${registryItem.category}'.`,
		);
	}

	const parseResult = registryItem.schema.safeParse(value);
	if (!parseResult.success) {
		const issues = parseResult.error.issues ?? [];
		const formattedErrors = issues
			.map((e) => `${e.path.join(".") || "value"}: ${e.message}`)
			.join("; ");
		throw new BadRequestError(
			`Validation failed for instance setting '${key}': ${formattedErrors}`,
		);
	}

	const parsedValue = parseResult.data;

	// Edge case handling for SSO and Auth settings
	if (key === "sso_config") {
		const ssoVal = parsedValue as ReturnType<typeof ssoConfigSchema.parse>;
		if (ssoVal.enabled) {
			if (ssoVal.provider === "oidc") {
				if (!ssoVal.clientId || !ssoVal.clientId.trim()) {
					throw new BadRequestError(
						"SSO configuration is enabled for OIDC provider, but required field 'clientId' is missing or empty.",
					);
				}
				if (!ssoVal.clientSecret || !ssoVal.clientSecret.trim()) {
					throw new BadRequestError(
						"SSO configuration is enabled for OIDC provider, but required field 'clientSecret' is missing or empty.",
					);
				}
			} else if (ssoVal.provider === "saml") {
				if (!ssoVal.entryPoint || !ssoVal.entryPoint.trim()) {
					throw new BadRequestError(
						"SSO configuration is enabled for SAML provider, but required field 'entryPoint' is missing or empty.",
					);
				}
				if (!ssoVal.samlCert || !ssoVal.samlCert.trim()) {
					throw new BadRequestError(
						"SSO configuration is enabled for SAML provider, but required field 'samlCert' is missing or empty.",
					);
				}
			}
		} else {
			// If disabling SSO, verify current auth_config isn't sso_only
			const currentAuthRow = await getInstanceSettingByKey("auth_config");
			if (currentAuthRow) {
				const currentAuthVal = currentAuthRow.value as { mode?: string };
				if (currentAuthVal.mode === "sso_only") {
					throw new BadRequestError(
						"Cannot disable SSO configuration while authentication mode is set to 'sso_only'. Please update auth_config mode to 'traditional' first.",
					);
				}
			}
		}
	} else if (key === "auth_config") {
		const authVal = parsedValue as ReturnType<typeof authConfigSchema.parse>;
		if (authVal.mode === "sso_only") {
			const currentSsoRow = await getInstanceSettingByKey("sso_config");
			if (!currentSsoRow) {
				throw new BadRequestError(
					"Cannot set authentication mode to 'sso_only' because SSO is not configured.",
				);
			}

			const ssoParse = ssoConfigSchema.safeParse(currentSsoRow.value);
			if (!ssoParse.success || !ssoParse.data.enabled) {
				throw new BadRequestError(
					"Cannot set authentication mode to 'sso_only' because SSO configuration is disabled or invalid.",
				);
			}

			const ssoVal = ssoParse.data;
			if (ssoVal.provider === "oidc") {
				if (!ssoVal.clientId?.trim() || !ssoVal.clientSecret?.trim()) {
					throw new BadRequestError(
						"Cannot set authentication mode to 'sso_only' because OIDC SSO configuration is incomplete (missing clientId or clientSecret).",
					);
				}
			} else if (ssoVal.provider === "saml") {
				if (!ssoVal.entryPoint?.trim() || !ssoVal.samlCert?.trim()) {
					throw new BadRequestError(
						"Cannot set authentication mode to 'sso_only' because SAML SSO configuration is incomplete (missing entryPoint or samlCert).",
					);
				}
			}
		}
	}

	const updated = await upsertInstanceSetting({
		key,
		category,
		value: parsedValue as Record<string, unknown>,
		isPublic,
	});

	// Notify all instances (incl. this one) to reload settings + rebuild auth.
	// The channel subscriber handles the reload; do NOT reload inline (that
	// re-subscribes and leaks a listener per call).
	await publishMessage(CHAN_ON_INSTANCE_SETTING_CHANGE, { key });

	return {
		message: "Instance setting saved successfully",
		data: updated,
	};
}

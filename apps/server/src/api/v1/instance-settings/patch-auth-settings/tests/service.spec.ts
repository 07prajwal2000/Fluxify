import { beforeEach, describe, expect, it, mock } from "bun:test";

const store: Record<string, { key: string; category: string; value: any; isPublic: boolean }> = {};
const published = mock((_channel: string, _payload: unknown) => {});

mock.module("../../upsert/repository", () => ({
	getInstanceSettingByKey: async (key: string) => store[key] ?? null,
	upsertInstanceSetting: async (data: { key: string; category: string; value: Record<string, unknown>; isPublic?: boolean }) => {
		store[data.key] = {
			key: data.key,
			category: data.category,
			value: data.value,
			isPublic: data.isPublic ?? store[data.key]?.isPublic ?? false,
		};
		return store[data.key];
	},
}));

mock.module("../../../../../db/redis", () => ({
	CHAN_ON_INSTANCE_SETTING_CHANGE: "instance_setting_change",
	publishMessage: (channel: string, payload: unknown) => published(channel, payload),
}));

const handleRequest = (await import("../service")).default;

const validOidc = {
	provider: "oidc",
	providerId: "enterprise",
	issuer: "https://idp.example.com",
	domain: "example.com",
	clientId: "client-1",
	clientSecret: "secret-1",
};

beforeEach(() => {
	for (const k of Object.keys(store)) delete store[k];
	published.mockClear();
});

describe("patch-auth-settings service", () => {
	it("enables SSO from a complete existing config with no patch", async () => {
		store.sso_config = { key: "sso_config", category: "auth", value: { ...validOidc, enabled: false }, isPublic: false };

		const result = await handleRequest({ type: "sso" });

		expect(result.type).toBe("sso");
		expect(store.sso_config.value.enabled).toBe(true);
		expect(store.auth_config.value.mode).toBe("sso_only");
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("rejects enabling SSO when required provider fields are missing", async () => {
		store.sso_config = {
			key: "sso_config",
			category: "auth",
			value: { ...validOidc, clientSecret: undefined, enabled: false },
			isPublic: false,
		};

		await expect(handleRequest({ type: "sso" })).rejects.toThrow(/clientSecret|clientId/);
	});

	it("disables SSO without wiping the stored config", async () => {
		store.sso_config = { key: "sso_config", category: "auth", value: { ...validOidc, enabled: true }, isPublic: false };

		const result = await handleRequest({ type: "traditional" });

		expect(result.type).toBe("traditional");
		expect(store.sso_config.value.enabled).toBe(false);
		expect(store.sso_config.value.issuer).toBe(validOidc.issuer); // preserved
		expect(store.auth_config.value.mode).toBe("traditional");
	});

	it("merges a partial sso_config patch instead of replacing it", async () => {
		store.sso_config = { key: "sso_config", category: "auth", value: { ...validOidc, enabled: true }, isPublic: false };

		const result = await handleRequest({ type: "sso", sso_config: { clientId: "new-client-id" } });

		expect(result.type).toBe("sso");
		expect(store.sso_config.value.clientId).toBe("new-client-id");
		expect(store.sso_config.value.issuer).toBe(validOidc.issuer); // untouched key survives the patch
		expect(store.sso_config.value.domain).toBe(validOidc.domain);
	});

	it("is a no-op for sso_config when switching to traditional with nothing stored", async () => {
		const result = await handleRequest({ type: "traditional" });

		expect(result.type).toBe("traditional");
		expect(store.sso_config).toBeUndefined();
		expect(store.auth_config.value.mode).toBe("traditional");
	});
});

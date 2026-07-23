import { describe, expect, it, mock, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as redis from "../../../../../db/redis";
import { BadRequestError } from "../../../../../errors/badRequestError";

mock.module("../repository", () => ({
	getInstanceSettingByKey: mock(),
	upsertInstanceSetting: mock(),
}));

mock.module("../../../../../db/redis", () => ({
	publishMessage: mock(),
	CHAN_ON_INSTANCE_SETTING_CHANGE: "chan:on-instance-setting-change",
}));

describe("upsert instance setting service", () => {
	beforeEach(() => {
		(repository.getInstanceSettingByKey as any).mockClear();
		(repository.upsertInstanceSetting as any).mockClear();
		(redis.publishMessage as any).mockClear();
	});

	it("should throw BadRequestError for an unregistered key", async () => {
		expect(
			handleRequest({ key: "invalid_key", value: {} }),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError if schema validation fails", async () => {
		expect(
			handleRequest({
				key: "sso_config",
				value: { provider: "invalid_provider" },
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError if input category does not match registry category", async () => {
		expect(
			handleRequest({
				key: "sso_config",
				category: "other" as any,
				value: {
					provider: "oidc",
					enabled: false,
					issuer: "https://auth.example.com",
					domain: "example.com",
				},
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError if OIDC SSO is enabled but missing clientId or clientSecret", async () => {
		expect(
			handleRequest({
				key: "sso_config",
				value: {
					provider: "oidc",
					enabled: true,
					issuer: "https://auth.example.com",
					domain: "example.com",
				},
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError if SAML SSO is enabled but missing entryPoint or samlCert", async () => {
		expect(
			handleRequest({
				key: "sso_config",
				value: {
					provider: "saml",
					enabled: true,
					issuer: "https://auth.example.com",
					domain: "example.com",
				},
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError if disabling SSO while auth mode is sso_only", async () => {
		(repository.getInstanceSettingByKey as any).mockImplementation((k: string) => {
			if (k === "auth_config") {
				return Promise.resolve({
					id: "auth-1",
					key: "auth_config",
					category: "auth",
					value: { mode: "sso_only" },
					isPublic: false,
				});
			}
			return Promise.resolve(null);
		});

		expect(
			handleRequest({
				key: "sso_config",
				value: {
					provider: "oidc",
					enabled: false,
					issuer: "https://auth.example.com",
					domain: "example.com",
				},
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should throw BadRequestError when setting auth_config to sso_only if sso_config is disabled or missing", async () => {
		(repository.getInstanceSettingByKey as any).mockResolvedValue(null);

		expect(
			handleRequest({
				key: "auth_config",
				value: { mode: "sso_only" },
			}),
		).rejects.toThrow(BadRequestError);
	});

	it("should successfully upsert valid OIDC sso_config", async () => {
		const validOidcVal = {
			provider: "oidc",
			enabled: true,
			issuer: "https://auth.example.com",
			domain: "example.com",
			clientId: "client-123",
			clientSecret: "secret-456",
		};
		const mockUpdated = {
			id: "sso-1",
			key: "sso_config",
			category: "auth",
			value: validOidcVal,
			isPublic: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		(repository.upsertInstanceSetting as any).mockResolvedValue(mockUpdated);

		const result = await handleRequest({
			key: "sso_config",
			value: validOidcVal,
		});

		expect(repository.upsertInstanceSetting).toHaveBeenCalledWith({
			key: "sso_config",
			category: "auth",
			value: expect.objectContaining(validOidcVal),
			isPublic: undefined,
		});
		expect(redis.publishMessage).toHaveBeenCalledWith(
			"chan:on-instance-setting-change",
			{ key: "sso_config" },
		);
		expect(result).toEqual({
			message: "Instance setting saved successfully",
			data: mockUpdated,
		});
	});
});

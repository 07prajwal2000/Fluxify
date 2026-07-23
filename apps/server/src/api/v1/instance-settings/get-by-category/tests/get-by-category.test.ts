import { describe, expect, it, mock, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";

mock.module("../repository", () => ({
	getInstanceSettingsByCategory: mock(),
}));

describe("get-by-category instance settings service", () => {
	beforeEach(() => {
		(repository.getInstanceSettingsByCategory as any).mockClear();
	});

	it("should return settings for the requested category", async () => {
		const mockSettings = [
			{
				id: "setting-1",
				key: "sso_config",
				category: "auth",
				value: { enabled: true, provider: "oidc", issuer: "https://auth.example.com", domain: "example.com" },
				isPublic: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];
		(repository.getInstanceSettingsByCategory as any).mockResolvedValue(mockSettings);

		const result = await handleRequest("auth");

		expect(repository.getInstanceSettingsByCategory).toHaveBeenCalledWith("auth");
		expect(result).toEqual(mockSettings);
	});
});

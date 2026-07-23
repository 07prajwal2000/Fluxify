import { describe, expect, it, mock, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";

mock.module("../repository", () => ({
	getAllInstanceSettings: mock(),
}));

describe("get-all instance settings service", () => {
	beforeEach(() => {
		(repository.getAllInstanceSettings as any).mockClear();
	});

	it("should return list of all instance settings from repository", async () => {
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
		(repository.getAllInstanceSettings as any).mockResolvedValue(mockSettings);

		const result = await handleRequest();

		expect(repository.getAllInstanceSettings).toHaveBeenCalledTimes(1);
		expect(result).toEqual(mockSettings);
	});
});

import { describe, expect, it, mock, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import { NotFoundError } from "../../../../../errors/notFoundError";

mock.module("../repository", () => ({
	getInstanceSettingByKey: mock(),
}));

describe("get-by-key instance settings service", () => {
	beforeEach(() => {
		(repository.getInstanceSettingByKey as any).mockClear();
	});

	it("should return setting if found", async () => {
		const mockSetting = {
			id: "setting-1",
			key: "sso_config",
			category: "auth",
			value: { enabled: true, provider: "oidc", issuer: "https://auth.example.com", domain: "example.com" },
			isPublic: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		(repository.getInstanceSettingByKey as any).mockResolvedValue(mockSetting);

		const result = await handleRequest("sso_config");

		expect(repository.getInstanceSettingByKey).toHaveBeenCalledWith("sso_config");
		expect(result).toEqual(mockSetting);
	});

	it("should throw NotFoundError if setting is not found", async () => {
		(repository.getInstanceSettingByKey as any).mockResolvedValue(null);

		expect(handleRequest("non_existent")).rejects.toThrow(NotFoundError);
	});
});

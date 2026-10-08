import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { OpenAIIntegration } from "@fluxify/adapters";

mock.module("../repository", () => ({ getAppConfigs: async () => [] }));
const { testIntegrationConnection } = await import("../service");

const config = { apiKey: "test-key", model: "gpt-test" };
const test = (timeoutMs?: number) =>
	testIntegrationConnection("p1", "ai", "OpenAI", config, "logs", timeoutMs);

afterEach(() => mock.restore());

// #672: a failed test must say why, never surface as a bare 500 or a hang
describe("testIntegrationConnection", () => {
	it("returns the driver's message when the probe throws", async () => {
		spyOn(OpenAIIntegration, "TestConnection").mockRejectedValue(new Error("401 Incorrect API key provided"));
		expect(await test()).toEqual({ success: false, error: "401 Incorrect API key provided" });
	});

	it("times out a probe that never answers", async () => {
		spyOn(OpenAIIntegration, "TestConnection").mockReturnValue(new Promise(() => {}));
		expect(await test(20)).toEqual({ success: false, error: "Connection timed out after 0.02 seconds" });
	});

	it("names the config fields that are wrong", async () => {
		const result = await testIntegrationConnection("p1", "ai", "OpenAI", { apiKey: "test-key" });
		expect(result.success).toBe(false);
		expect(result.error).toStartWith("Invalid configuration: model:");
	});
});

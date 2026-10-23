import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { OpenAIIntegration } from "@fluxify/adapters";

mock.module("../repository", () => ({ getAppConfigs: async () => [] }));
const { testIntegrationConnection, default: handleRequest } = await import("../service");
const { audit } = await import("../../../../../modules/audit");
const { BadRequestError } = await import("../../../../../errors/badRequestError");

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

// #690: a probe that ran and failed is an answer (200), only a bad request is a 400
describe("handleRequest", () => {
	const body = (cfg: Record<string, unknown>) => ({ group: "ai", variant: "OpenAI", config: cfg }) as never;

	it("answers a failed probe with the reason instead of throwing", async () => {
		spyOn(audit, "record").mockResolvedValue(undefined as never);
		spyOn(OpenAIIntegration, "TestConnection").mockRejectedValue(new Error("401 Incorrect API key provided"));
		expect(await handleRequest("p1", body(config))).toEqual({
			success: false,
			error: "401 Incorrect API key provided",
		});
	});

	it("refuses config fields that are wrong as a bad request, before any probe", async () => {
		spyOn(audit, "record").mockResolvedValue(undefined as never);
		const probe = spyOn(OpenAIIntegration, "TestConnection");
		const refused = handleRequest("p1", body({ apiKey: "test-key" }));
		await expect(refused).rejects.toBeInstanceOf(BadRequestError);
		await expect(refused).rejects.toThrow(/^Invalid configuration: model:/);
		expect(probe).not.toHaveBeenCalled();
	});
});


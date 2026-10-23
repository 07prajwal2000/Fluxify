import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { OpenAIIntegration } from "@fluxify/adapters";

const repository = await import("../repository");
const { default: handleRequest } = await import("../service");

afterEach(() => mock.restore());

const saved = {
	id: "i1",
	projectId: "p1",
	name: "openai",
	group: "ai",
	variant: "OpenAI",
	config: { apiKey: "test-key", model: "gpt-test" },
	devConfig: null,
	syncDev: true,
};

// #690: a saved integration's failed test answers like the unsaved one, not as a 400
describe("test-existing-connection", () => {
	it("answers a failed probe with the reason instead of throwing", async () => {
		spyOn(repository, "getIntegrationById").mockResolvedValue(saved as never);
		spyOn(OpenAIIntegration, "TestConnection").mockRejectedValue(new Error("401 Incorrect API key provided"));
		expect(await handleRequest({ projectId: "p1", id: "i1" })).toEqual({
			success: false,
			error: "401 Incorrect API key provided",
		});
	});

	it("still says not found for an integration that does not exist", async () => {
		spyOn(repository, "getIntegrationById").mockResolvedValue(undefined as never);
		await expect(handleRequest({ projectId: "p1", id: "nope" })).rejects.toThrow(/not found/);
	});
});

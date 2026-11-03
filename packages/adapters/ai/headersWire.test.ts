import { afterAll, beforeAll, expect, it } from "bun:test";
import { integrationRegistry } from "../integrations";
import { OpenAICompatibleIntegration } from "./openAiCompatible";

/** a local HTTP server stands in for a gateway: what arrives on the wire is what the provider would see */
const seen: { path: string; headers: Headers }[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			seen.push({ path: new URL(req.url).pathname, headers: req.headers });
			return Response.json({ data: [{ id: "m1" }] });
		},
	});
});
afterAll(() => server.stop(true));

it("a stored row's headers, cfg: values included, reach the server on a model call and a listing", async () => {
	const stored = {
		baseUrl: `http://localhost:${server.port}/v1`,
		apiKey: "cfg:KEY",
		model: "llama3",
		headers: { "x-gateway-org": "acme", "x-gateway-token": "cfg:TOKEN" },
	};
	const def = integrationRegistry.require("ai", "OpenAI Compatible");
	expect(def.configSchema.safeParse(stored).success).toBe(true);
	// the same steps the loader takes: expand cfg: references, then build the adapter
	const config = def.resolve!(stored, { KEY: "sk-wire", TOKEN: "tok-123" });
	const ai = def.create!(config, {} as never) as OpenAICompatibleIntegration;

	await ai
		.languageModel()
		.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
		.catch(() => {});
	await OpenAICompatibleIntegration.ListModels(config);

	expect(seen.map((s) => s.path)).toEqual(["/v1/chat/completions", "/v1/models"]);
	for (const { headers } of seen) {
		expect(headers.get("x-gateway-org")).toBe("acme");
		expect(headers.get("x-gateway-token")).toBe("tok-123");
		expect(headers.get("authorization")).toBe("Bearer sk-wire");
	}
	// the row in the database still holds the reference, never the secret
	expect(stored.headers["x-gateway-token"]).toBe("cfg:TOKEN");
});

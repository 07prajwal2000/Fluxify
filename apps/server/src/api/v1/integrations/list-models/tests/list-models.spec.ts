import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import handleRequest, { clearModelsCache, MODELS_CACHE_TTL_MS } from "../service";

// a local server stands in for the provider: what arrives is what the provider would see
let server: ReturnType<typeof Bun.serve>;
let hits = 0;
let auth: string | null = null;
let status = 200;
beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			hits++;
			auth = req.headers.get("authorization");
			if (status !== 200) return new Response("bad key", { status });
			return Response.json({ data: [{ id: "m1", name: "Model One", context_length: 1000 }] });
		},
	});
});
afterAll(() => server.stop(true));
beforeEach(() => {
	hits = 0;
	status = 200;
	clearModelsCache();
});

const body = (over: Record<string, unknown> = {}, refresh = false) =>
	({
		variant: "OpenAI Compatible",
		config: { baseUrl: `http://localhost:${server.port}/v1`, apiKey: "sk-test", ...over },
		refresh,
	}) as never;

it("lists the models with the key, and the key is not in the answer", async () => {
	const res = await handleRequest("p1", body());
	expect(res).toEqual({ models: [{ id: "m1", name: "Model One", contextLength: 1000 }] });
	expect(auth).toBe("Bearer sk-test");
	expect(JSON.stringify(res)).not.toContain("sk-test");
});

it("serves a repeat from the cache until it is 10 minutes old, and refresh skips it", async () => {
	const t = 1_000_000;
	await handleRequest("p1", body(), t);
	expect((await handleRequest("p1", body(), t + 1000)).cached).toBe(true);
	expect(hits).toBe(1);
	await handleRequest("p1", body({}, true), t + 2000);
	expect(hits).toBe(2);
	expect((await handleRequest("p1", body(), t + 2000 + MODELS_CACHE_TTL_MS)).cached).toBeUndefined();
	expect(hits).toBe(3);
});

it("a changed key is a different cache entry", async () => {
	await handleRequest("p1", body());
	await handleRequest("p1", body({ apiKey: "sk-other" }));
	expect(hits).toBe(2);
});

it("says why when the provider refuses, never throws", async () => {
	status = 401;
	expect(await handleRequest("p1", body())).toEqual({ models: [], error: "401 bad key" });
});

it("asks for the missing key or base URL without calling anyone", async () => {
	const noKey = await handleRequest("p1", { variant: "OpenAI", config: {}, refresh: false });
	expect(noKey.error).toBe("Add an API key to load models");
	const noUrl = await handleRequest("p1", { variant: "OpenAI Compatible", config: {}, refresh: false });
	expect(noUrl.error).toBe("Add a Base URL to load models");
	expect(hits).toBe(0);
});

it("an unreachable provider is an error, not a crash", async () => {
	const res = await handleRequest("p1", body({ baseUrl: "http://localhost:1/v1" }));
	expect(res.models).toEqual([]);
	expect(res.error).toBeTruthy();
});

import { expect, mock, test } from "bun:test";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
mock.module("@/lib/http", () => ({
	httpClient: {
		get: async (url: string) => {
			calls.push({ method: "get", url });
			return { data: { versions: [], uncommitted: false } };
		},
		post: async (url: string, body: unknown) => {
			calls.push({ method: "post", url, body });
			return { data: { ok: true } };
		},
	},
}));

// a fresh copy, so another test file's earlier import cannot hand us its own http client
const fresh = "./versions?fresh";
const { versionsService } = (await import(fresh)) as typeof import("./versions");

test("a route's history lives under /routes and a workflow's under /workflows", async () => {
	calls.length = 0;
	await versionsService.list("route", "r1");
	await versionsService.list("workflow", "w1");
	await versionsService.get("route", "r1", "v1");
	expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
		"get /v1/routes/r1/versions",
		"get /v1/workflows/w1/versions",
		"get /v1/routes/r1/versions/v1",
	]);
});

test("commit and checkout post to the version paths", async () => {
	calls.length = 0;
	await versionsService.commit("workflow", "w1", { title: "First" });
	await versionsService.checkout("route", "r1", "v2", { title: "Saved before" });
	expect(calls).toEqual([
		{ method: "post", url: "/v1/workflows/w1/versions", body: { title: "First" } },
		{ method: "post", url: "/v1/routes/r1/versions/v2/checkout", body: { title: "Saved before" } },
	]);
});

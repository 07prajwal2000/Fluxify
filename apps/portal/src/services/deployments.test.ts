import { expect, mock, test } from "bun:test";

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
mock.module("@/lib/http", () => ({
	httpClient: {
		get: async (url: string) => {
			calls.push({ method: "get", url });
			return { data: { deployments: [] } };
		},
		post: async (url: string, body: unknown) => {
			calls.push({ method: "post", url, body });
			return { data: { ok: true } };
		},
	},
}));

// a fresh copy, so another test file's earlier import cannot hand us its own http client
const fresh = "./deployments?fresh";
const { deploymentsService } = (await import(fresh)) as typeof import("./deployments");

test("promote, rollback and the log hang off each kind's own segment (#740)", async () => {
	calls.length = 0;
	await deploymentsService.list("route", "r1");
	await deploymentsService.list("workflow", "w1");
	await deploymentsService.list("custom_block", "b1");
	await deploymentsService.list("middleware", "m1");
	await deploymentsService.deploy("custom_block", "b1", {
		versionId: "v1",
		description: "why",
	});
	expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
		"get /v1/routes/r1/deployments",
		"get /v1/workflows/w1/deployments",
		"get /v1/custom-blocks/b1/deployments",
		"get /v1/middlewares/m1/deployments",
		"post /v1/custom-blocks/b1/deployments",
	]);
});

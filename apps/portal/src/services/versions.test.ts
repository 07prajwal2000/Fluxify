import { afterEach, expect, spyOn, test } from "bun:test";
import { httpClient } from "@/lib/http";
import { versionsService } from "./versions";

afterEach(() => {
	for (const method of ["get", "post"] as const) {
		(httpClient[method] as { mockRestore?: () => void }).mockRestore?.();
	}
});

test("a route's history lives under /routes and a workflow's under /workflows", async () => {
	const get = spyOn(httpClient, "get").mockResolvedValue({ data: { versions: [], uncommitted: false } });
	await versionsService.list("route", "r1");
	await versionsService.list("workflow", "w1");
	await versionsService.get("route", "r1", "v1");
	expect(get.mock.calls.map((call) => call[0])).toEqual([
		"/v1/routes/r1/versions",
		"/v1/workflows/w1/versions",
		"/v1/routes/r1/versions/v1",
	]);
});

test("commit and checkout post to the version paths", async () => {
	const post = spyOn(httpClient, "post").mockResolvedValue({ data: { ok: true } });
	await versionsService.commit("workflow", "w1", { title: "First" });
	await versionsService.checkout("route", "r1", "v2", { title: "Saved before" });
	expect(post.mock.calls).toEqual([
		["/v1/workflows/w1/versions", { title: "First" }],
		["/v1/routes/r1/versions/v2/checkout", { title: "Saved before" }],
	]);
});

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { httpClient } from "@/lib/http";
import { pluginsService, upgradeBlockedFromError } from "./plugins";

// Other portal specs replace `@/lib/http` with a partial client for the whole
// process, so the methods are swapped on whatever object the service sees,
// and put back, instead of `spyOn` (which needs the method to exist).
const METHODS = ["get", "post", "put", "delete"] as const;
const client = httpClient as unknown as Record<(typeof METHODS)[number], unknown>;
const original = { ...client };
const fake = () => mock(async (..._args: unknown[]) => ({ data: {} }));
let get = fake();
let post = fake();
let put = fake();
let del = fake();

beforeEach(() => {
	[get, post, put, del] = [fake(), fake(), fake(), fake()];
	Object.assign(client, { get, post, put, delete: del });
});
afterEach(() => {
	for (const m of METHODS) {
		if (m in original) client[m] = original[m];
		else delete client[m];
	}
});

const project = { params: { projectId: "p1" } };

test("a plugin's name goes into the path as scope/name, the project in the query", async () => {
	await pluginsService.list("p1");
	await pluginsService.installStatus("p1", "acme/slack");
	await pluginsService.usage("p1", "acme/slack");
	await pluginsService.upgradePreview("p1", "acme/slack");
	expect(get.mock.calls).toEqual([
		["/v1/plugins/list", project],
		["/v1/plugins/acme/slack/install-status", project],
		["/v1/plugins/acme/slack/usage", project],
		["/v1/plugins/acme/slack/upgrade-preview", project],
	]);
});

test("environments, approval, scan and removal hit their endpoints", async () => {
	await pluginsService.setEnvironments("p1", "acme/slack", { dev: true, prod: false });
	await pluginsService.approve("p1", "acme/slack", "sha-1");
	await pluginsService.reject("p1", "acme/slack");
	await pluginsService.scan("p1", "acme/slack");
	await pluginsService.scanProject("p1");
	await pluginsService.remove("p1", "acme/slack");
	expect(put).toHaveBeenCalledWith(
		"/v1/plugins/acme/slack/environments",
		{ dev: true, prod: false },
		project,
	);
	expect(post.mock.calls.map((c) => c[0])).toEqual([
		"/v1/plugins/acme/slack/approve",
		"/v1/plugins/acme/slack/reject",
		"/v1/plugins/acme/slack/scan",
		"/v1/plugins/scan",
	]);
	expect(post.mock.calls[0]?.[1]).toEqual({ integrity: "sha-1" });
	expect(del).toHaveBeenCalledWith("/v1/plugins/acme/slack", project);
});

test("the four sources: upload as multipart, npm, the two URL steps, and a folder", async () => {
	const file = new File(["x"], "slack.tgz");
	await pluginsService.upload("p1", file);
	await pluginsService.addNpm("p1", "@acme/slack@1.0.0");
	await pluginsService.requestUrl("p1", "https://cdn.example/p.tgz");
	await pluginsService.fetchUrl("p1", "req1");
	await pluginsService.urlRequests("p1");
	await pluginsService.discoverFs("p1");
	await pluginsService.addFs("p1", "slack");

	const [url, form, config] = post.mock.calls[0] as unknown as [string, FormData, object];
	expect(url).toBe("/v1/plugins/upload");
	expect((form.get("file") as File).name).toBe("slack.tgz");
	expect(config).toMatchObject({ headers: { "Content-Type": "multipart/form-data" } });
	expect(post.mock.calls.slice(1).map((c) => [c[0], c[1]])).toEqual([
		["/v1/plugins/npm", { spec: "@acme/slack@1.0.0" }],
		["/v1/plugins/url", { url: "https://cdn.example/p.tgz" }],
		["/v1/plugins/url/req1/fetch", undefined],
		["/v1/plugins/fs", { path: "slack" }],
	]);
	expect(get.mock.calls.map((c) => c[0])).toEqual(["/v1/plugins/url/list", "/v1/plugins/fs/discover"]);
});

test("upgradeBlockedFromError reads the diff of a 409 and ignores other failures", () => {
	const diff = { blocking: true, blockers: ["param x is removed"] };
	expect(
		upgradeBlockedFromError({ response: { data: { message: "Cannot replace", diff } } }),
	).toEqual({ message: "Cannot replace", diff } as never);
	expect(upgradeBlockedFromError(new Error("boom"))).toBeUndefined();
	expect(upgradeBlockedFromError({ response: { data: { message: "no diff" } } })).toBeUndefined();
});

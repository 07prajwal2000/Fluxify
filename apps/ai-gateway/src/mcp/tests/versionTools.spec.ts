import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { needsApproval } from "../../agent/tools";
import type { AdminApi } from "../adminApi";
import { MCP_INSTRUCTIONS } from "../instructions";
import { versionTools } from "../versionTools";

type Call = { method: string; path: string; body?: unknown };

function fakeApi(answer: (path: string) => unknown) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
			return answer(path);
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return answer(path);
		},
	};
	return { api, calls };
}

const R = "019a0000-0000-7000-8000-0000000000a1";
const W = "019a0000-0000-7000-8000-0000000000b2";
const V = "019a0000-0000-7000-8000-0000000000c3";

const tool = (name: string) => versionTools.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

const version = (n: number, extra: object = {}) => ({
	id: `${V}-${n}`,
	kind: "route",
	targetId: R,
	versionNumber: n,
	title: `v${n} title`,
	description: null,
	author: "ada@example.com",
	authorEmail: "ada@example.com",
	createdAt: "2026-10-11T10:00:00.000Z",
	parentId: n > 1 ? `${V}-${n - 1}` : null,
	isHead: false,
	...extra,
});

describe("version tools", () => {
	it("commit_version posts the title to the route's or workflow's versions and returns a short summary", async () => {
		const { api, calls } = fakeApi(() => version(1, { isHead: true }));
		const route: any = await run(
			"commit_version",
			{ kind: "route", id: R, title: "Add paging", description: "page + perPage" },
			api,
		);
		await run("commit_version", { kind: "workflow", id: W, title: "Nightly sync" }, api);
		expect(calls).toEqual([
			{
				method: "POST",
				path: `/v1/routes/${R}/versions`,
				body: { title: "Add paging", description: "page + perPage" },
			},
			{
				method: "POST",
				path: `/v1/workflows/${W}/versions`,
				body: { title: "Nightly sync", description: undefined },
			},
		]);
		expect(route).toMatchObject({ versionId: `${V}-1`, versionNumber: 1, isHead: true });
		expect(route.targetId).toBeUndefined();
	});

	it("commit_version needs a title", () => {
		const input = z.object(tool("commit_version").input);
		expect(input.safeParse({ kind: "route", id: R }).success).toBe(false);
		expect(input.safeParse({ kind: "route", id: R, title: "" }).success).toBe(false);
	});

	it("list_versions says whether there is uncommitted work and names each version's parent", async () => {
		const { api, calls } = fakeApi(() => ({
			uncommitted: true,
			versions: [version(2, { isHead: true }), version(1)],
		}));
		const out: any = await run("list_versions", { kind: "route", id: R }, api);
		expect(calls).toEqual([{ method: "GET", path: `/v1/routes/${R}/versions` }]);
		expect(out.uncommitted).toBe(true);
		expect(out.versions.map((v: any) => [v.versionNumber, v.isHead, v.parentVersionId])).toEqual([
			[2, true, `${V}-1`],
			[1, false, null],
		]);
	});

	it("get_version shows the canvas the way get_canvas does, with the settings, and no revision", async () => {
		const snapshot = {
			settings: { path: "/users", method: "GET", timeoutSeconds: 30, middlewares: { before: ["m1"], after: [] } },
			blocks: [
				{ id: "b1", key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{
					id: "b2",
					key: "response_1",
					type: "response",
					data: { httpCode: "200", blockDescription: "the happy path" },
					position: { x: 1, y: 0 },
				},
			],
			edges: [{ id: "e1", from: "b1", to: "b2", fromHandle: "b1-source", toHandle: "b2-target" }],
		};
		const { api, calls } = fakeApi(() => ({ ...version(3), snapshot }));
		const out: any = await run("get_version", { kind: "route", id: R, versionId: `${V}-3` }, api);
		expect(calls).toEqual([{ method: "GET", path: `/v1/routes/${R}/versions/${V}-3` }]);
		expect(out.versionNumber).toBe(3);
		expect(out.settings).toEqual(snapshot.settings);
		expect(out.revision).toBeUndefined();
		expect(out.blocks.map((b: any) => b.key)).toEqual(["entrypoint_1", "response_1"]);
		expect(out.blocks[1]).toMatchObject({ note: "the happy path", data: { httpCode: "200" } });
		expect(out.edges).toEqual(["entrypoint_1 → response_1"]);

		const compact: any = await run(
			"get_version",
			{ kind: "route", id: R, versionId: `${V}-3`, compact: true },
			api,
		);
		expect(compact.blocks[1].data).toBeUndefined();
		expect(compact.blocks[1].summary).toContain("httpCode");
	});

	it("checkout_version posts the title, reports the saved work and gives the revision to edit from", async () => {
		const { api, calls } = fakeApi(() => ({
			savedVersion: version(4, { title: "Saved before checking out v3" }),
			checkedOut: version(3, { isHead: true }),
			canvasRevision: 17,
			warnings: [],
		}));
		const out: any = await run(
			"checkout_version",
			{ kind: "route", id: R, versionId: `${V}-3`, title: "Rate limit, half done" },
			api,
		);
		expect(calls).toEqual([
			{
				method: "POST",
				path: `/v1/routes/${R}/versions/${V}-3/checkout`,
				body: { title: "Rate limit, half done" },
			},
		]);
		expect(out).toMatchObject({
			checkedOut: { versionNumber: 3, isHead: true },
			savedVersion: { versionNumber: 4, title: "Saved before checking out v3" },
			revision: 17,
		});
		expect(out.warnings).toBeUndefined();
	});

	it("checkout_version leaves savedVersion out when there was nothing to save, and passes warnings on", async () => {
		const { api } = fakeApi(() => ({
			checkedOut: version(1, { isHead: true }),
			canvasRevision: 3,
			warnings: ["1 middleware(s) from that version no longer exist and were not attached."],
		}));
		const out: any = await run("checkout_version", { kind: "workflow", id: W, versionId: V }, api);
		expect(out.savedVersion).toBeUndefined();
		expect(out.warnings).toHaveLength(1);
	});

	it("describes what commit and checkout do and do not do, and asks like any other write", () => {
		const commit = tool("commit_version").description;
		expect(commit).toContain("never deploys");
		expect(commit).toContain("meaningful title");
		const out = tool("checkout_version").description;
		expect(out).toContain("saved first");
		expect(out).toContain("nothing is lost");
		expect(out).toContain("meaningful title");

		// reads never ask; commit and checkout ask in manual, run unasked in auto
		for (const name of ["list_versions", "get_version"]) {
			expect(tool(name).annotations?.readOnlyHint ?? true).toBe(true);
			expect(needsApproval("manual", name)).toBe(false);
		}
		for (const name of ["commit_version", "checkout_version"]) {
			expect(needsApproval("manual", name)).toBe(true);
			expect(needsApproval("auto", name)).toBe(false);
		}
	});

	describe("promote_version and rollback_version (#739)", () => {
		const deployment = (n: number, extra: object = {}) => ({
			id: "d1",
			action: "promote",
			status: "live",
			versionNumber: n,
			description: "ok",
			gates: [],
			createdAt: "2026-10-11T10:00:00.000Z",
			...extra,
		});
		const routeDetail = { prodVersionNumber: 3 };

		it("promote_version posts the version with the person's comment and the agent's note", async () => {
			const { api, calls } = fakeApi(() => deployment(4));
			const out: any = await tool("promote_version").call(api, {
				kind: "route",
				id: R,
				versionId: `${V}-4`,
				note: "adds retry",
				comment: "Fixes the 500s",
			});
			expect(calls).toEqual([
				{
					method: "POST",
					path: `/v1/routes/${R}/deployments`,
					body: { versionId: `${V}-4`, description: "Fixes the 500s\n\nAgent: adds retry" },
				},
			]);
			expect(out).toMatchObject({ deploymentId: "d1", status: "live", versionNumber: 4 });
			expect(out.failed).toBeUndefined();
		});

		it("says what stopped a deployment", async () => {
			const gates = [
				{ gate: "compile", status: "passed", message: "The version compiles" },
				{
					gate: "values",
					status: "failed",
					message: "Production has no value for:",
					items: ["app config key TOKEN has no production value"],
				},
			];
			const { api } = fakeApi(() => deployment(4, { status: "failed", gates }));
			const out: any = await run("promote_version", { kind: "workflow", id: W, versionId: V }, api);
			expect(out.status).toBe("failed");
			expect(out.failed).toEqual([
				{
					gate: "values",
					message: "Production has no value for:",
					items: ["app config key TOKEN has no production value"],
				},
			]);
		});

		it("rollback_version refuses a version that is not older than production's, and says to use promote", async () => {
			const posts: string[] = [];
			const { api } = fakeApi((path) => {
				if (path.endsWith("/deployments")) posts.push(path);
				return path.includes("/versions/") ? version(5) : routeDetail;
			});
			await expect(
				run("rollback_version", { kind: "route", id: R, versionId: `${V}-5` }, api),
			).rejects.toThrow("Use promote_version");
			expect(posts).toEqual([]);
		});

		it("rollback_version goes back to an older version", async () => {
			const { api, calls } = fakeApi((path) =>
				path.endsWith("/deployments")
					? deployment(1, { action: "rollback" })
					: path.includes("/versions/")
						? version(1)
						: routeDetail,
			);
			const out: any = await run(
				"rollback_version",
				{ kind: "route", id: R, versionId: `${V}-1`, note: "it broke" },
				api,
			);
			expect(out).toMatchObject({ action: "rollback", versionNumber: 1 });
			expect(calls.at(-1)).toMatchObject({
				method: "POST",
				path: `/v1/routes/${R}/deployments`,
				body: { description: "Agent: it broke" },
			});
		});

		it("rollback_version has nothing to go back to before the first promote", async () => {
			const { api } = fakeApi((path) => (path.includes("/versions/") ? version(1) : { prodVersionNumber: null }));
			await expect(
				run("rollback_version", { kind: "workflow", id: W, versionId: V }, api),
			).rejects.toThrow("nothing to roll back to");
		});

		it("always ask, and the descriptions say what goes live, the checks and that a person approves", () => {
			for (const name of ["promote_version", "rollback_version"]) {
				expect(needsApproval("manual", name)).toBe(true);
				expect(needsApproval("auto", name)).toBe(true);
				const text = tool(name).description;
				expect(text).toContain("production");
				expect(text).toContain("production value");
				expect(text).toContain("A person approves every call");
				expect(tool(name).role).toBe("creator");
			}
			expect(MCP_INSTRUCTIONS).toContain("Never call promote_version or rollback_version unless the user asks");
		});

		it("marks the live version in list_versions", async () => {
			const { api } = fakeApi(() => ({
				uncommitted: false,
				versions: [version(2, { isHead: true }), version(1, { isProd: true })],
			}));
			const out: any = await run("list_versions", { kind: "route", id: R }, api);
			expect(out.versions.map((v: any) => [v.versionNumber, v.isProd])).toEqual([
				[2, undefined],
				[1, true],
			]);
		});
	});

	it("is introduced to every client in the instructions", () => {
		expect(MCP_INSTRUCTIONS).toContain("commit_version");
		expect(MCP_INSTRUCTIONS).toContain("Commit when a piece of work is done and tested");
	});
});

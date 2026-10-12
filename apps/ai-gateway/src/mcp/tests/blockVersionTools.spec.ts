import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { needsApproval, touchesProd } from "../../agent/tools";
import type { AdminApi } from "../adminApi";
import { MCP_INSTRUCTIONS } from "../instructions";
import { readTools } from "../tools";
import { versionTools } from "../versionTools";

// Custom blocks and middlewares are versioned like routes and workflows (#740):
// the same six tools take them, and the two read tools say where they stand.

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

const BLOCK = "019a0000-0000-7000-8000-0000000000d4";
const MIDDLEWARE = "019a0000-0000-7000-8000-0000000000e5";
const V = "019a0000-0000-7000-8000-0000000000c3";

const tool = (name: string) => versionTools.find((t) => t.name === name)!;
const readTool = (name: string) => readTools.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

const version = (n: number, extra: object = {}) => ({
	id: `${V}-${n}`,
	versionNumber: n,
	title: `v${n}`,
	description: null,
	author: "ada@example.com",
	createdAt: "2026-10-12T10:00:00.000Z",
	parentId: null,
	isHead: false,
	isProd: false,
	...extra,
});

const KINDS = [
	{ kind: "custom_block", id: BLOCK, root: "/v1/custom-blocks" },
	{ kind: "middleware", id: MIDDLEWARE, root: "/v1/middlewares" },
] as const;

describe("version tools take custom blocks and middlewares", () => {
	for (const { kind, id, root } of KINDS) {
		it(`${kind}: commit, list, get and checkout use ${root}`, async () => {
			const { api, calls } = fakeApi((path) => {
				if (path.endsWith("/versions")) {
					return calls.at(-1)?.method === "POST"
						? version(1, { isHead: true })
						: { uncommitted: false, versions: [version(1, { isHead: true })] };
				}
				if (path.endsWith("/checkout")) {
					return { checkedOut: version(1, { isHead: true }), canvasRevision: 4, warnings: [] };
				}
				return {
					...version(1),
					snapshot: {
						blocks: [],
						edges: [],
						settings: kind === "middleware" ? { chain: [BLOCK] } : { inputParams: null, usage: "flow" },
					},
				};
			});

			await run("commit_version", { kind, id, title: "First" }, api);
			await run("list_versions", { kind, id }, api);
			const detail: any = await run("get_version", { kind, id, versionId: `${V}-1` }, api);
			await run("checkout_version", { kind, id, versionId: `${V}-1` }, api);

			expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
				`POST ${root}/${id}/versions`,
				`GET ${root}/${id}/versions`,
				`GET ${root}/${id}/versions/${V}-1`,
				`POST ${root}/${id}/versions/${V}-1/checkout`,
			]);
			// the definition a version keeps is shown with it
			expect(detail.settings).toEqual(
				kind === "middleware" ? { chain: [BLOCK] } : { inputParams: null, usage: "flow" },
			);
		});

		it(`${kind}: promote and rollback post a deployment with the person's comment`, async () => {
			const { api, calls } = fakeApi((path) => {
				if (path.endsWith("/deployments")) {
					return { id: "d1", action: "promote", status: "live", versionNumber: 2, gates: [], description: "x" };
				}
				if (path.includes("/versions/")) return version(1);
				return { prodVersionNumber: 2 };
			});
			await tool("promote_version").call(api, {
				kind,
				id,
				versionId: `${V}-2`,
				note: "shared by five routes",
				comment: "Fixes the rounding",
			});
			await tool("rollback_version").call(api, { kind, id, versionId: `${V}-1`, comment: "Broke prod" });

			const posts = calls.filter((c) => c.method === "POST");
			expect(posts).toEqual([
				{
					method: "POST",
					path: `${root}/${id}/deployments`,
					body: {
						versionId: `${V}-2`,
						description: "Fixes the rounding\n\nAgent: shared by five routes",
					},
				},
				{
					method: "POST",
					path: `${root}/${id}/deployments`,
					body: { versionId: `${V}-1`, description: "Broke prod" },
				},
			]);
			// rollback reads production's version from the block or middleware itself
			expect(calls).toContainEqual({ method: "GET", path: `${root}/${id}` });
		});

		it(`${kind}: promote and rollback always ask, in every mode, and never as a session approval`, () => {
			const args = { kind, id, versionId: `${V}-2` };
			for (const mode of ["manual", "auto", "plan"] as const) {
				for (const name of ["promote_version", "rollback_version"]) {
					expect(needsApproval(mode, name, false, args, { reads: false, writes: false })).toBe(true);
					expect(touchesProd(name, args)).toBe("write");
				}
			}
		});
	}

	it("says what stopped a route and which custom blocks to promote first, with their ids", async () => {
		const gates = [
			{
				gate: "custom_blocks",
				status: "failed",
				message: "1 custom block used here has no production version yet",
				items: ['custom block "tax" has no production version'],
				refs: [{ kind: "custom_block", id: BLOCK, name: "tax" }],
			},
			{ gate: "tests", status: "skipped", message: "Not run: an earlier check failed" },
		];
		const { api } = fakeApi(() => ({
			id: "d1",
			action: "promote",
			status: "failed",
			versionNumber: 3,
			gates,
		}));
		const out: any = await run("promote_version", { kind: "route", id: BLOCK, versionId: V }, api);
		expect(out.failed).toEqual([
			{
				gate: "custom_blocks",
				message: "1 custom block used here has no production version yet",
				items: ['custom block "tax" has no production version'],
				refs: [{ kind: "custom_block", id: BLOCK, name: "tax" }],
			},
		]);
	});

	it("still refuses a kind that has no versions", () => {
		const input = z.object(tool("commit_version").input);
		expect(input.safeParse({ kind: "sandbox", id: BLOCK, title: "x" }).success).toBe(false);
		expect(input.safeParse({ kind: "custom_block", id: BLOCK, title: "x" }).success).toBe(true);
	});

	it("explains the shared-library effect to the model that is about to promote", () => {
		const text = tool("promote_version").description;
		expect(text).toContain("changes every production route and workflow that uses it");
		expect(text).toContain("needs a production version of its own");
		expect(text).not.toContain("current state in production");
		expect(MCP_INSTRUCTIONS).toContain("custom_block or middleware");
	});
});

describe("get_custom_block and get_middleware show where they stand", () => {
	it("get_custom_block adds the versions, whether it is uncommitted, and who uses it", async () => {
		const references = [
			{ kind: "route", id: "r1", name: "orders", inProduction: true, inWorkingCopy: true },
		];
		const { api, calls } = fakeApi((path) =>
			path.endsWith("/references")
				? { references }
				: {
						id: BLOCK,
						name: "user_defined.project.tax",
						label: "Tax",
						description: null,
						usage: "flow",
						inputParams: [],
						docs: null,
						headVersionNumber: 3,
						prodVersionNumber: 2,
						uncommitted: true,
						createdAt: "ignored",
					},
		);
		const out: any = await readTool("get_custom_block").call(api, { customBlockId: BLOCK });
		expect(calls.map((c) => c.path).sort()).toEqual([
			`/v1/custom-blocks/${BLOCK}`,
			`/v1/custom-blocks/${BLOCK}/references`,
		]);
		expect(out).toMatchObject({ headVersionNumber: 3, prodVersionNumber: 2, uncommitted: true, references });
		expect(out.createdAt).toBeUndefined();
	});

	it("get_middleware adds the versions, whether it is uncommitted, and the routes that attach it", async () => {
		const references = [
			{ kind: "route", id: "r1", name: "orders", inProduction: false, inWorkingCopy: true },
		];
		const { api } = fakeApi((path) =>
			path.endsWith("/references")
				? { references }
				: {
						id: MIDDLEWARE,
						name: "auth",
						description: null,
						blocks: [{ id: BLOCK, name: "guard", label: "Guard" }],
						headVersionNumber: 1,
						prodVersionNumber: null,
						uncommitted: false,
					},
		);
		const out: any = await readTool("get_middleware").call(api, { middlewareId: MIDDLEWARE });
		expect(out).toMatchObject({
			headVersionNumber: 1,
			prodVersionNumber: null,
			uncommitted: false,
			references,
			blocks: [{ id: BLOCK, name: "guard", label: "Guard" }],
		});
	});
});

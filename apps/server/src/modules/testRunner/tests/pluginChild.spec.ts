import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BlockMeta, BlockTypes, compileGraph } from "@fluxify/blocks";
import type { PluginBlockRef } from "../../requestRouter/pluginLoader";
import { runSuiteInChild } from "../spawn";
import type { TestBootstrap } from "../types";

const root = mkdtempSync(join(tmpdir(), "fx-test-child-plugin-"));
const stepFile = join(root, "dist", "blocks", "step.js");
mkdirSync(join(root, "dist", "blocks"), { recursive: true });
writeFileSync(
	stepFile,
	"export default { run: () => ({ output: { echo: 'from-plugin-block' }, handle: 'success' }) };",
);

const ref: PluginBlockRef = {
	projectId: "p1",
	type: "acme/echo/step",
	plugin: "acme/echo",
	version: "1.0.0",
	entry: stepFile,
	meta: {
		handles: {
			in: ["target"],
			out: ["success", "failure"],
			body: [],
		} as any,
		invoke: ["sync"],
	},
};

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});

describe("test execution child with plugin blocks", () => {
	const meta: BlockMeta = ref.meta;
	const { source, pluginBlocks } = compileGraph(
		[
			{ id: "1", type: BlockTypes.entrypoint, position: { x: 0, y: 0 }, data: {} },
			{ id: "2", type: "acme/echo/step", position: { x: 0, y: 0 }, data: {} },
			{ id: "3", type: BlockTypes.response, position: { x: 0, y: 0 }, data: { httpCode: "200" } },
		],
		[edge("1", "2"), edge("2", "3", "success")] as any,
		{ projectId: "p1", blockMeta: { "acme/echo/step": meta } },
	);

	it("loads plugin blocks before instantiating and executes them", async () => {
		const boot: TestBootstrap = {
			suiteRunId: "run-p1",
			testRunId: "test-run-p1",
			projectId: "p1",
			source,
			customBlocks: [],
			pluginBlocks,
			pluginRefs: [ref],
			config: {
				appConfig: {},
				dbIntegrations: {},
				kvIntegrations: {},
				observabilityIntegrations: {},
				aiIntegrations: {},
				projectSettings: {},
			},
			route: { id: "r1", projectName: "demo" },
			request: {
				method: "GET",
				path: "/test",
				headers: {},
				query: {},
				params: {},
				body: null,
			},
			timeoutMs: 10_000,
			assertions: [{ target: "status", operator: "eq", expectedValue: "200" }],
			hooks: [],
			suite: { id: "s1", name: "Plugin suite" },
		};

		const result = await runSuiteInChild(boot);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Number(result.status)).toBe(200);
			expect(result.data).toEqual({ echo: "from-plugin-block" });
			expect(result.verdict.success).toBe(true);
		}
	}, 30_000);

	it("fails with an error when plugin refs are not supplied", async () => {
		const boot: TestBootstrap = {
			suiteRunId: "run-p2",
			testRunId: "test-run-p2",
			projectId: "p1",
			source,
			customBlocks: [],
			pluginBlocks,
			pluginRefs: [],
			config: {
				appConfig: {},
				dbIntegrations: {},
				kvIntegrations: {},
				observabilityIntegrations: {},
				aiIntegrations: {},
				projectSettings: {},
			},
			route: { id: "r1", projectName: "demo" },
			request: {
				method: "GET",
				path: "/test",
				headers: {},
				query: {},
				params: {},
				body: null,
			},
			timeoutMs: 10_000,
			assertions: [],
			hooks: [],
			suite: { id: "s1", name: "Plugin suite missing ref" },
		};

		const result = await runSuiteInChild(boot);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("no plugin installed provides block acme/echo/step");
		}
	}, 30_000);
});

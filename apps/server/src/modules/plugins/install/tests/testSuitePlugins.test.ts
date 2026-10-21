import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { BlockTypes } from "@fluxify/blocks";
import { pluginStatusKey } from "@fluxify/common/orchestrator";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import {
	blocksEntity,
	edgesEntity,
	routesEntity,
	testRunsEntity,
	testSuiteRunsEntity,
	testSuitesEntity,
	workflowsEntity,
} from "../../../../db/schema";
import { shutdownCompiledRuntime } from "../../../requestRouter/compiledRuntime";
import { startTestRun } from "../../../testRunner/runner";
import { serveTestRuns } from "../../../testRunner/workerHost";
import { setup, startStack, stopStack } from "../../sources/tests/stack";
import { pluginTgz } from "../../sources/tests/tarball";
import { entry, manifest } from "../../tests/fixtures";
import { startWorker, until } from "./worker";

let sql: Awaited<ReturnType<typeof startStack>>["sql"];
beforeAll(async () => {
	sql = (await startStack("test-suite-plugins")).sql;
}, 240_000);

afterAll(async () => {
	await shutdownCompiledRuntime();
	await stopStack();
});

const NAME = "acme/echo";
const TYPE = `${NAME}/step`;
const URL_ = "https://github.com/acme/fluxify-echo";

const sdkBlock = (type: string, tag: string) => `import { block, handle } from "@fluxify/sdk/blocks";
export default block({
	name: "${type}",
	label: "Step",
	invoke: ["sync"],
	handles: { out: [handle.out("success"), handle.out("failure")] },
	run: () => ({ output: "${tag}", handle: "success" }),
});`;

function files(version: string, tag: string) {
	const peers = { "@fluxify/sdk": ">=2026.10.2001", zod: "^4.0.0" };
	return {
		"package.json": JSON.stringify({
			name: `@${NAME}`,
			version,
			peerDependencies: peers,
			fluxify: { name: NAME, url: URL_ },
		}),
		"fluxify.json": JSON.stringify(manifest(NAME, [entry(TYPE)])),
		"bun.lock": null,
		"dist/blocks/step.js": sdkBlock(TYPE, tag),
	};
}

const tgz = (version = "2026.10.2001", tag = "peer") => pluginTgz(files(version, tag));

async function projectWithPlugin(envs = { dev: true, prod: false }) {
	const s = await setup();
	expect((await s.upload(tgz())).status).toBe(200);
	expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
	expect((await s.put(`/${NAME}/environments`, envs)).status).toBe(200);
	return s;
}

const ready = (status: Record<string, { state: string }>, project: string) =>
	status[pluginStatusKey(project, NAME)]?.state === "ready";

const testProcessEntry = fileURLToPath(
	new URL("../../../testRunner/testExecutionProcess.ts", import.meta.url),
);

const edge = (from: string, to: string, handle = "source") => ({
	id: Bun.randomUUIDv7(),
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});

async function wireRoute(projectId: string, routeId: string) {
	await db.insert(routesEntity).values({
		id: routeId,
		projectId,
		method: "GET",
		path: "/test-route",
		timeoutSeconds: 15,
	});
	const b1 = Bun.randomUUIDv7();
	const b2 = Bun.randomUUIDv7();
	const b3 = Bun.randomUUIDv7();
	const blocks = [
		{ id: b1, key: "entrypoint", routeId, projectId, type: BlockTypes.entrypoint, position: { x: 0, y: 0 }, data: {} },
		{ id: b2, key: "step", routeId, projectId, type: TYPE, position: { x: 100, y: 0 }, data: {} },
		{ id: b3, key: "response", routeId, projectId, type: BlockTypes.response, position: { x: 200, y: 0 }, data: { httpCode: "200" } },
	];
	const edges = [
		{ ...edge(b1, b2), routeId, projectId },
		{ ...edge(b2, b3, "success"), routeId, projectId },
	];
	await db.insert(blocksEntity).values(blocks as any);
	await db.insert(edgesEntity).values(edges as any);
	return { blocks, edges };
}

async function wireWorkflow(projectId: string, workflowId: string) {
	await db.insert(workflowsEntity).values({
		id: workflowId,
		name: "test-wf",
		projectId,
		timeoutSeconds: 15,
	});
	const b1 = Bun.randomUUIDv7();
	const b2 = Bun.randomUUIDv7();
	const b3 = Bun.randomUUIDv7();
	const blocks = [
		{ id: b1, key: "entrypoint", workflowId, projectId, type: BlockTypes.entrypoint, position: { x: 0, y: 0 }, data: {} },
		{ id: b2, key: "step", workflowId, projectId, type: TYPE, position: { x: 100, y: 0 }, data: {} },
		{ id: b3, key: "end", workflowId, projectId, type: BlockTypes.response, position: { x: 200, y: 0 }, data: { httpCode: "200" } },
	];
	const edges = [
		{ ...edge(b1, b2), workflowId, projectId },
		{ ...edge(b2, b3, "success"), workflowId, projectId },
	];
	await db.insert(blocksEntity).values(blocks as any);
	await db.insert(edgesEntity).values(edges as any);
	return { blocks, edges };
}

describe("test suites with plugin blocks", () => {
	it("runs a route test suite using a plugin block on a worker", async () => {
		const s = await projectWithPlugin({ dev: true, prod: false });
		const worker = await startWorker(s.project, "development");
		const testHost = serveTestRuns(s.project, testProcessEntry, () => worker.installer.refs(), "development");
		try {
			await until(worker.status, () => ready(worker.status(), s.project));
			const routeId = Bun.randomUUIDv7();
			await wireRoute(s.project, routeId);

			const suiteId = Bun.randomUUIDv7();
			await db.insert(testSuitesEntity).values({
				id: suiteId,
				projectId: s.project,
				routeId,
				name: "route plugin suite",
				assertions: [
					{ target: "status", operator: "eq", expectedValue: "200" },
					{ target: "customJs", customJs: "t.expect(fluxify.response.body).toBe('peer');" },
				] as any,
			});

			const started = await startTestRun({
				projectId: s.project,
				target: { type: "route", id: routeId },
			});
			await started.done;

			const [run] = await db.select().from(testRunsEntity).where(eq(testRunsEntity.id, started.runId));
			expect(run?.status).toBe("passed");
			const [suiteRun] = await db.select().from(testSuiteRunsEntity).where(eq(testSuiteRunsEntity.testRunId, started.runId));
			expect(suiteRun?.status).toBe("passed");
			expect((suiteRun?.result as any)?.actualData).toBe("peer");
		} finally {
			await testHost.stop();
			await worker.stop();
		}
	}, 240_000);

	it("runs a workflow test suite using a plugin block on a worker", async () => {
		const s = await projectWithPlugin({ dev: true, prod: false });
		const worker = await startWorker(s.project, "development");
		const testHost = serveTestRuns(s.project, testProcessEntry, () => worker.installer.refs(), "development");
		try {
			await until(worker.status, () => ready(worker.status(), s.project));
			const workflowId = Bun.randomUUIDv7();
			await wireWorkflow(s.project, workflowId);

			const suiteId = Bun.randomUUIDv7();
			await db.insert(testSuitesEntity).values({
				id: suiteId,
				projectId: s.project,
				workflowId,
				name: "workflow plugin suite",
				input: { source: "manual", value: null } as any,
				assertions: [] as any,
			});

			const started = await startTestRun({
				projectId: s.project,
				target: { type: "workflow", id: workflowId },
			});
			await started.done;

			const [run] = await db.select().from(testRunsEntity).where(eq(testRunsEntity.id, started.runId));
			expect(run?.status).toBe("passed");
		} finally {
			await testHost.stop();
			await worker.stop();
		}
	}, 240_000);

	it("a candidate suite fails with clear error when plugin is not installed for worker env", async () => {
		// Enabled ONLY in production; development worker will NOT install it
		const s = await projectWithPlugin({ dev: false, prod: true });
		const worker = await startWorker(s.project, "development");
		const testHost = serveTestRuns(s.project, testProcessEntry, () => worker.installer.refs(), "development");
		try {
			const routeId = Bun.randomUUIDv7();
			const { blocks, edges } = await wireRoute(s.project, routeId);

			const suiteId = Bun.randomUUIDv7();
			await db.insert(testSuitesEntity).values({
				id: suiteId,
				projectId: s.project,
				routeId,
				name: "candidate plugin suite",
				assertions: [{ target: "status", operator: "eq", expectedValue: "200" }] as any,
			});

			const started = await startTestRun({
				projectId: s.project,
				target: { type: "route", id: routeId },
				env: "production",
				candidate: {
					versionId: "cand-v1",
					snapshot: {
						blocks,
						edges,
						settings: { path: "/test-route", method: "GET", timeoutSeconds: 15 },
					} as any,
				},
			});
			await started.done;

			const [run] = await db.select().from(testRunsEntity).where(eq(testRunsEntity.id, started.runId));
			expect(run?.status).toBe("failed");
			const [suiteRun] = await db.select().from(testSuiteRunsEntity).where(eq(testSuiteRunsEntity.testRunId, started.runId));
			expect(suiteRun?.status).toBe("error");
			expect((suiteRun?.result as any)?.error).toContain(
				"plugin acme/echo 2026.10.2001 isn't installed on this worker yet; retry when installation finishes",
			);
		} finally {
			await testHost.stop();
			await worker.stop();
		}
	}, 240_000);

	it("a candidate suite passes when plugin is installed on worker", async () => {
		// Enabled in both dev and prod: dev worker has it installed
		const s = await projectWithPlugin({ dev: true, prod: true });
		const worker = await startWorker(s.project, "development");
		const testHost = serveTestRuns(s.project, testProcessEntry, () => worker.installer.refs(), "development");
		try {
			await until(worker.status, () => ready(worker.status(), s.project));
			const routeId = Bun.randomUUIDv7();
			const { blocks, edges } = await wireRoute(s.project, routeId);

			const suiteId = Bun.randomUUIDv7();
			await db.insert(testSuitesEntity).values({
				id: suiteId,
				projectId: s.project,
				routeId,
				name: "candidate plugin suite passes",
				assertions: [{ target: "status", operator: "eq", expectedValue: "200" }] as any,
			});

			const started = await startTestRun({
				projectId: s.project,
				target: { type: "route", id: routeId },
				env: "production",
				candidate: {
					versionId: "cand-v2",
					snapshot: {
						blocks,
						edges,
						settings: { path: "/test-route", method: "GET", timeoutSeconds: 15 },
					} as any,
				},
			});
			await started.done;

			const [run] = await db.select().from(testRunsEntity).where(eq(testRunsEntity.id, started.runId));
			expect(run?.status).toBe("passed");
			const [suiteRun] = await db.select().from(testSuiteRunsEntity).where(eq(testSuiteRunsEntity.testRunId, started.runId));
			expect(suiteRun?.status).toBe("passed");
		} finally {
			await testHost.stop();
			await worker.stop();
		}
	}, 240_000);

	it("a version mismatch gives the clear message", async () => {
		const s = await projectWithPlugin({ dev: true, prod: false });
		const worker = await startWorker(s.project, "development");
		await until(worker.status, () => ready(worker.status(), s.project));
		// Worker is pinned to v1 refs (simulating an upgrade mid-rollout)
		const v1Refs = [...worker.installer.refs()];
		const testHost = serveTestRuns(s.project, testProcessEntry, () => v1Refs, "development");
		try {
			// Upload and approve version 2026.10.2002
			expect((await s.upload(tgz("2026.10.2002", "v2"))).status).toBe(200);
			expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);

			const routeId = Bun.randomUUIDv7();
			await wireRoute(s.project, routeId);

			const suiteId = Bun.randomUUIDv7();
			await db.insert(testSuitesEntity).values({
				id: suiteId,
				projectId: s.project,
				routeId,
				name: "version mismatch suite",
				assertions: [] as any,
			});

			const started = await startTestRun({
				projectId: s.project,
				target: { type: "route", id: routeId },
			});
			await started.done;

			const [run] = await db.select().from(testRunsEntity).where(eq(testRunsEntity.id, started.runId));
			expect(run?.status).toBe("failed");
			const [suiteRun] = await db.select().from(testSuiteRunsEntity).where(eq(testSuiteRunsEntity.testRunId, started.runId));
			expect(suiteRun?.status).toBe("error");
			expect((suiteRun?.result as any)?.error).toContain(
				"plugin acme/echo 2026.10.2002 isn't installed on this worker yet; retry when installation finishes",
			);
		} finally {
			await testHost.stop();
			await worker.stop();
		}
	}, 240_000);
});

// The OLAP backend (#760) against a real ClickHouse: schema, recordings,
// appended system logs and audit events, as the repositories use them.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ClickHouseClient } from "@clickhouse/client";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { faker } from "@faker-js/faker";
import type Docker from "dockerode";
import type { AuditEvent } from "../../audit/types";
import { chDistinct, chInsertAudit, chListAudit, chProjectsWithEvents } from "../audit";
import { migrateClickhouse } from "../index";
import { chCaseTraces, chDeleteRuns, chGetRun, chInsertRecording, chListRuns, type RunRow } from "../recordings";
import { chListLogs, chWriteLog } from "../systemLogs";

const IMAGE = "clickhouse/clickhouse-server:24.8";
const NAME = "fluxify-olap-clickhouse-test";
let container: Docker.Container;
let c: ClickHouseClient;

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Env: ["CLICKHOUSE_SKIP_USER_SETUP=1"],
			HostConfig: { PortBindings: { "8123/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "8123/tcp": {} },
		}),
	);
	container = started.container;
	const url = `http://localhost:${started.port}`;
	for (let i = 0; ; i++) {
		try {
			c = await migrateClickhouse(url, "fluxify_test");
			break;
		} catch (error) {
			if (i > 120) throw error;
			await Bun.sleep(500);
		}
	}
	// a second boot must not fail on existing tables
	await (await migrateClickhouse(url, "fluxify_test")).close();
}, 180_000);

afterAll(async () => {
	await c?.close();
	await container?.remove({ force: true }).catch(() => {});
});

const project = () => `p_${faker.string.alphanumeric(8)}`;

function run(projectId: string, over: Partial<RunRow> = {}): RunRow {
	return {
		id: crypto.randomUUID(),
		projectId,
		routeId: "r1",
		versionId: null,
		startedAt: new Date(),
		endedAt: new Date(),
		outcome: "success",
		truncated: false,
		droppedSpans: 0,
		spanCount: 1,
		env: "production",
		...over,
	};
}

const span = (runId: string, seq: number, input: unknown) => ({
	runId,
	seq,
	blockId: `b${seq}`,
	blockType: "js",
	startedAt: new Date(),
	endedAt: new Date(),
	outcome: "success" as const,
	truncated: false,
	input,
	output: { ok: true },
});

describe("schema", () => {
	it("ages every table out by TTL", async () => {
		for (const table of ["trace_runs", "trace_spans", "system_logs", "audit_events"]) {
			const rs = await c.query({ query: `SHOW CREATE TABLE ${table}`, format: "TabSeparatedRaw" });
			expect(await rs.text()).toContain("TTL");
		}
	});
});

describe("recordings", () => {
	it("stores a run once, keeps span values and finds it by search and test run", async () => {
		const p = project();
		const r = run(p, {
			statusCode: 418,
			metadata: {
				source: "test",
				label: "Checkout 100%",
				testRunId: "tr1",
				suiteId: "s1",
				suiteName: "Suite",
				caseIndex: 2,
				caseName: "Case",
			},
		});
		const spans = [span(r.id, 0, true), span(r.id, 1, 42)];
		expect(await chInsertRecording(c, r, spans)).toBe(true);
		expect(await chInsertRecording(c, r, spans)).toBe(false);

		const target = { type: "route" as const, id: "r1" };
		const list = await chListRuns(c, p, target, {}, 0, 10);
		expect(list.totalCount).toBe(1);
		expect(list.result[0]?.statusCode).toBe(418);
		expect(list.result[0]?.startedAt).toBeInstanceOf(Date);
		expect((await chListRuns(c, p, target, { search: "checkout" }, 0, 10)).totalCount).toBe(1);
		expect((await chListRuns(c, p, target, { search: "nope" }, 0, 10)).totalCount).toBe(0);
		expect((await chListRuns(c, p, target, { source: "live" }, 0, 10)).totalCount).toBe(0);
		expect((await chListRuns(c, p, { type: "route", id: "other" }, {}, 0, 10)).totalCount).toBe(0);
		expect((await chListRuns(c, project(), target, {}, 0, 10)).totalCount).toBe(0);

		const got = await chGetRun(c, p, target, r.id);
		expect(got?.spans.map((s) => s.input)).toEqual([true, 42]);
		expect(got?.metadata?.label).toBe("Checkout 100%");
		expect(await chCaseTraces(c, p, "tr1")).toEqual([{ traceRunId: r.id, suiteId: "s1", caseIndex: 2 }]);
	});

	it("lists forked runs and deletes a run with its spans and runtime logs", async () => {
		const p = project();
		const parent = run(p);
		const child = run(p, { parentRunId: parent.id, parentSeq: 0 });
		await chInsertRecording(c, parent, [span(parent.id, 0, null)]);
		await chInsertRecording(c, child, []);
		await chWriteLog(c, {
			projectId: p,
			resourceType: "route",
			resourceId: "r1",
			type: "runtime",
			level: "error",
			message: "boom",
			detail: null,
			runId: parent.id,
		});
		const target = { type: "route" as const, id: "r1" };
		expect((await chGetRun(c, p, target, parent.id))?.childRuns).toEqual([{ id: child.id, parentSeq: 0 }]);

		expect(await chDeleteRuns(c, p, target, parent.id)).toBe(1);
		expect(await chGetRun(c, p, target, parent.id)).toBeNull();
		const spans = await c.query({
			query: "SELECT count() AS n FROM trace_spans WHERE run_id = {id:UUID}",
			query_params: { id: parent.id },
			format: "JSONEachRow",
		});
		expect(await spans.json()).toEqual([{ n: 0 }]);
		const logs = await chListLogs(c, { projectId: p, limit: 10, userId: "u", sandboxIds: [] });
		expect(logs).toHaveLength(0);
		expect(await chDeleteRuns(c, p, target)).toBe(1);
	});
});

describe("system logs", () => {
	it("shows ephemeral rows and sandbox rows only to their owner", async () => {
		const p = project();
		const base = { projectId: p, level: "info" as const, message: "m" };
		await chWriteLog(c, { ...base, resourceType: "ephemeral", resourceId: "e1", type: "ephemeral", detail: { userId: "alice", env: "development" } });
		await chWriteLog(c, { ...base, resourceType: "sandbox", resourceId: "sb1", type: "runtime", detail: null });
		await chWriteLog(c, { ...base, resourceType: "route", resourceId: "r1", type: "runtime", detail: { env: "production" } });

		const list = (userId: string, sandboxIds: string[], extra = {}) =>
			chListLogs(c, { projectId: p, limit: 10, userId, sandboxIds, ...extra });
		expect((await list("alice", ["sb1"])).map((r) => r.resourceId).sort()).toEqual(["e1", "r1", "sb1"]);
		expect((await list("bob", [])).map((r) => r.resourceId)).toEqual(["r1"]);
		expect((await list("alice", ["sb1"], { env: "production" })).map((r) => r.resourceId).sort()).toEqual(["r1", "sb1"]);
		const [row] = await list("bob", [], { type: "runtime" });
		expect(row?.updatedAt).toBeInstanceOf(Date);
		expect(typeof row?.id).toBe("number");
	});
});

describe("audit events", () => {
	const event = (over: Partial<AuditEvent> = {}): AuditEvent =>
		({
			id: crypto.randomUUID(),
			ts: new Date().toISOString(),
			actorId: "u1",
			actorEmail: "a_b@x.io",
			source: "portal",
			projectId: null,
			projectName: null,
			projectSlug: null,
			resourceType: "route",
			resourceId: "r1",
			action: "update",
			changedFields: ["name"],
			status: "ok",
			message: null,
			...over,
		}) as AuditEvent;

	it("collapses redelivered ids, pages by cursor and matches text literally", async () => {
		const actorId = `actor_${faker.string.alphanumeric(8)}`;
		const p = project();
		const events = [0, 1, 2].map((i) =>
			event({ actorId, ts: new Date(Date.now() - i * 1000).toISOString(), projectId: p, projectName: `n${i}`, projectSlug: `s${i}` }),
		);
		await chInsertAudit(c, events);
		await chInsertAudit(c, events);

		const page1 = await chListAudit(c, { actorId }, undefined, 2);
		expect(page1.map((e) => e.id)).toEqual([events[0]!.id, events[1]!.id]);
		const last = page1[1]!;
		const page2 = await chListAudit(c, { actorId }, { ts: last.ts, id: last.id }, 2);
		expect(page2.map((e) => e.id)).toEqual([events[2]!.id]);

		expect(await chListAudit(c, { actorId, actorEmail: "A_B" }, undefined, 10)).toHaveLength(3);
		// `_` is literal, not a wildcard
		expect(await chListAudit(c, { actorId, actorEmail: "a_bx" }, undefined, 10)).toHaveLength(0);
		expect(page1[0]?.changedFields).toEqual(["name"]);

		expect(await chDistinct(c, "action")).toContain("update");
		const named = (await chProjectsWithEvents(c)).find((r) => r.id === p);
		expect(named).toEqual({ id: p, name: "n0", slug: "s0" });
	});
});

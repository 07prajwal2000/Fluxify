// The agent runner (#646) against a real NATS 2.14 (JetStream) and a real
// Postgres: live events replay then follow with no gap or duplicate, a refresh
// with afterSeq picks the partial message back up, and a whole job's events
// carry the seqs its messages really got.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats } from "@fluxify/common/nats";
import { migrateDB } from "@fluxify/server/src/db/migration";
import { SQL } from "bun";
import type Docker from "dockerode";
import { scripted } from "../resume.fixture";
import type { AgentStore } from "../store";
import type { AgentEvent } from "./events";

const PG = { image: "postgres:16-alpine", name: "fluxify-agent-runner-pg-test" };
const NATS = { image: "nats:2.14", name: "fluxify-agent-runner-nats-test" };
const containers: Docker.Container[] = [];
let sql: SQL;
let queue: typeof import("./queue");
let events: typeof import("./events");
let repo: typeof import("./repository");
let job: typeof import("./job");
let worker: typeof import("./worker");
let relay: typeof import("../../api/v1/agent/stream").relay;
let store: AgentStore;

async function start(spec: { image: string; name: string }, port: number, extra: object) {
	await docker.getContainer(spec.name).remove({ force: true }).catch(() => {});
	await pullImage(spec.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: spec.image,
			name: spec.name,
			HostConfig: { PortBindings: { [`${port}/tcp`]: [{ HostPort: String(host) }] } },
			ExposedPorts: { [`${port}/tcp`]: {} },
			...extra,
		}),
	);
	containers.push(started.container);
	return started.port;
}

async function retry<T>(attempt: () => Promise<T>, tries = 90): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await attempt();
		} catch (error) {
			if (i >= tries) throw error;
			await Bun.sleep(500);
		}
	}
}

beforeAll(async () => {
	const [pgPort, natsPort] = await Promise.all([
		start(PG, 5432, { Env: ["POSTGRES_PASSWORD=postgres"] }),
		start(NATS, 4222, { Cmd: ["-js"] }),
	]);
	const url = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`;
	await retry(async () => {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
		} finally {
			await probe.close().catch(() => {});
		}
	});
	await migrateDB(url);
	sql = new SQL(url);
	const server = await import("@fluxify/server");
	// As in the gateway: the worker module loads before drizzleInit sets `db`.
	worker = await import("./worker");
	// The env is read once per process, maybe before this file ran: point PG_URL here for the init only.
	const env = await import("@fluxify/server/src/lib/env");
	const realEnv = env.getEnv;
	const pgUrl = spyOn(env, "getEnv").mockImplementation((k) => (k === "PG_URL" ? url : realEnv(k)));
	await server.drizzleInit(false);
	pgUrl.mockRestore();
	await retry(async () => {
		await closeNats().catch(() => {});
		await connectNats({ servers: `nats://127.0.0.1:${natsPort}` });
	}, 60);
	queue = await import("./queue");
	events = await import("./events");
	repo = await import("./repository");
	job = await import("./job");
	relay = (await import("../../api/v1/agent/stream")).relay;
	store = (await import("../store")).agentStore(server.db);
	await queue.initializeAgentQueue();
	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
}, 180_000);

afterAll(async () => {
	await closeNats().catch(() => {});
	await sql?.close().catch(() => {});
	await Promise.allSettled(containers.map((c) => c.remove({ force: true })));
});

/** Reads a run's stream like the SSE endpoint does, until done. */
async function client(runId: string, afterSeq: number) {
	const reader = await queue.readRunEvents(runId);
	const got: AgentEvent[] = [];
	const ended = relay(reader, afterSeq, async (e) => void got.push(e)).finally(() => reader.stop());
	return { got, ended };
}

const text = (list: AgentEvent[], seq?: number) =>
	list
		.filter((e) => e.type === "text" && (seq === undefined || e.seq === seq))
		.map((e) => (e.type === "text" ? e.text : ""))
		.join("");

describe("live events on JetStream", () => {
	it("a client that joins mid-run gets the replay then the live tail: no gap, no duplicate", async () => {
		const runId = crypto.randomUUID();
		const b = events.batcher((e) => queue.publishRunEvents(runId, e), (e) => {
			throw e;
		}, 10);
		const words = Array.from({ length: 40 }, (_, i) => `w${i} `);
		let late: Awaited<ReturnType<typeof client>> | undefined;
		for (const [i, w] of words.entries()) {
			b.push({ type: "text", seq: i < 20 ? 1 : 3, text: w });
			if (i === 20) await b.flush();
			if (i === 25) late = await client(runId, -1);
			await Bun.sleep(3);
		}
		b.push({ type: "done", seq: 3, status: "completed" });
		await b.flush();
		expect(await late?.ended).toBe(true);
		expect(text(late?.got ?? [])).toBe(words.join(""));
		expect(late?.got.at(-1)).toEqual({ type: "done", seq: 3, status: "completed" });
	});

	it("a refresh with afterSeq shows the partial message and keeps streaming", async () => {
		const runId = crypto.randomUUID();
		const b = events.batcher((e) => queue.publishRunEvents(runId, e), () => {}, 10);
		b.push({ type: "text", seq: 1, text: "saved already" });
		b.push({ type: "tool-start", seq: 1, toolCallId: "a", toolName: "get_route", toolTitle: "Get route", input: {} });
		b.push({ type: "tool-end", seq: 2, toolCallId: "a", toolName: "get_route", status: "done", output: "ok" });
		b.push({ type: "text", seq: 3, text: "partial " });
		await b.flush();
		// The page reloaded: rows 0..2 come from Postgres, row 3 is still streaming.
		const refreshed = await client(runId, 2);
		b.push({ type: "text", seq: 3, text: "and the rest" });
		b.push({ type: "done", seq: 3, status: "completed" });
		await b.flush();
		expect(await refreshed.ended).toBe(true);
		expect(refreshed.got.every((e) => e.type === "done" || e.seq === 3)).toBe(true);
		expect(text(refreshed.got)).toBe("partial and the rest");
	});

	it("purging a run's events leaves the next part of the run alone", async () => {
		const runId = crypto.randomUUID();
		await queue.publishRunEvents(runId, [{ type: "done", seq: 1, status: "waiting_approval" }]);
		expect(await queue.purgeRunEvents(runId)).toBe(1);
		const next = await client(runId, 1);
		await queue.publishRunEvents(runId, [
			{ type: "text", seq: 3, text: "after the approval" },
			{ type: "done", seq: 3, status: "completed" },
		]);
		expect(await next.ended).toBe(true);
		expect(next.got.map((e) => e.type)).toEqual(["text", "done"]);
	});
});

describe("a job against Postgres and NATS", () => {
	it("start → waiting_approval → approve → completed, events tagged with the saved seqs", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const runId = await repo.startRun(c.id, "build it", "manual");
		expect(runId).toBeString();
		expect(await repo.startRun(c.id, "again", "manual")).toBeNull();
		const m = scripted([["save_route"]]);
		const { approve: _, ...agent } = m.agent;
		const deps = {
			store,
			claimRun: repo.claimRun,
			settle: repo.settleConversation,
			build: async () => agent,
			publish: queue.publishRunEvents,
			batchMs: 10,
		};
		const id = runId as string;
		const base = { conversationId: c.id, runId: id, userId: "u1", projectId: "p1", mode: "manual" as const };
		const signal = new AbortController().signal;

		expect(await job.executeRun({ ...base, type: "start", message: "build it" }, deps, signal)).toBe(
			"waiting_approval",
		);
		expect(await job.executeRun({ ...base, type: "start", message: "build it" }, deps, signal)).toBe(
			"skipped",
		);
		expect((await repo.getConversation(c.id))?.status).toBe("paused_hitl");
		const first = await client(id, -1);
		expect(await first.ended).toBe(true);
		const rows = await store.all(c.id);
		const approval = first.got.find((e) => e.type === "approval");
		expect(approval?.seq).toBe(rows.find((r) => r.role === "assistant")?.seq as number);

		expect(await repo.claimContinue(c.id, id)).toBe(true);
		expect(await repo.claimContinue(c.id, id)).toBe(false);
		await queue.purgeRunEvents(id);
		expect(
			await job.executeRun({ ...base, type: "continue", approval: { ok: true } }, deps, signal),
		).toBe("completed");
		const all = await store.all(c.id);
		const last = all.at(-1);
		const second = await client(id, (last?.seq as number) - 1);
		expect(await second.ended).toBe(true);
		expect(text(second.got, last?.seq)).toBe("done");
		expect(second.got.at(-1)).toEqual({ type: "done", seq: last?.seq as number, status: "completed" });
		expect((await repo.getConversation(c.id))?.status).toBe("completed");
		expect((await repo.getRun(id))?.status).toBe("completed");
	});

	it("stopping a run that waits for an approval rejects the call and frees the conversation", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const id = (await repo.startRun(c.id, "build it", "manual")) as string;
		const m = scripted([["save_route"]]);
		const { approve: _, ...agent } = m.agent;
		const deps = {
			store,
			claimRun: repo.claimRun,
			settle: repo.settleConversation,
			build: async () => agent,
			publish: queue.publishRunEvents,
		};
		const j = { type: "start" as const, conversationId: c.id, runId: id, userId: "u1", projectId: "p1", mode: "manual" as const, message: "x" };
		await job.executeRun(j, deps, new AbortController().signal);
		expect(await repo.interruptIdle(c.id, id)).toBe(true);
		await job.rejectPending(store, c.id, id, "the user stopped the run");
		expect((await repo.getRun(id))?.status).toBe("interrupted");
		expect((await repo.getConversation(c.id))?.status).toBe("interrupted");
		expect((await store.all(c.id)).at(-1)?.role).toBe("tool");
		expect(await repo.startRun(c.id, "next", "auto")).toBeString();
	});
});

describe("compact job", () => {
	it("takes the run lock, saves the summary row, streams the compaction and frees the conversation", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const { approve: _, ...agent } = scripted([["get_route"]], async () => ({ ok: true })).agent;
		const first = (await repo.startRun(c.id, "go", "auto")) as string;
		await job.executeRun(
			{ type: "start", conversationId: c.id, runId: first, userId: "u1", projectId: "p1", mode: "auto", message: "go" },
			{ ...worker.deps, build: async () => agent },
			new AbortController().signal,
		);
		await store.append(c.id, first, [{ role: "user", content: "now test it" }, { role: "assistant", content: "tested" }]);
		const before = (await store.all(c.id)).length;

		const id = (await repo.startRun(c.id, "/compact keep the ids", "auto")) as string;
		// the lock: nothing else can start while the compact job holds the conversation
		expect(await repo.startRun(c.id, "again", "auto")).toBeNull();
		const { executeCompact } = await import("./compactJob");
		const status = await executeCompact(
			{ type: "compact", conversationId: c.id, runId: id, userId: "u1", projectId: "p1", mode: "auto", keep: "the ids" },
			{ ...worker.deps, build: async () => agent },
			new AbortController().signal,
		);
		expect(status).toBe("completed");
		const rows = await store.all(c.id);
		expect(rows).toHaveLength(before + 1);
		expect(rows.at(-1)).toMatchObject({ role: "summary", coversUpToSeq: before - 3 });
		expect(rows.at(-1)?.content).toMatchObject({ compaction: { kind: "summary" } });
		const seen = await client(id, -1);
		expect(await seen.ended).toBe(true);
		expect(seen.got.map((e) => e.type)).toEqual(["compaction", "done"]);
		expect(seen.got[0]).toMatchObject({ seq: before });
		expect((await repo.getRun(id))?.status).toBe("completed");
		expect((await repo.getConversation(c.id))?.status).toBe("completed");
		expect(await repo.startRun(c.id, "next", "auto")).toBeString();
	});
});

describe("SSE endpoint", () => {
	async function sse(path: string) {
		const { Hono } = await import("hono");
		const { registerAgentRoutes } = await import("../../api/v1/agent/register");
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("user" as never, { id: "admin", isSystemAdmin: true } as never);
			c.set("acl" as never, [] as never);
			await next();
		});
		registerAgentRoutes(app as never);
		const res = await app.request(path);
		return { status: res.status, body: await res.text() };
	}

	it("replays a finished run's events after afterSeq and ends", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const id = (await repo.startRun(c.id, "hi", "auto")) as string;
		await queue.publishRunEvents(id, [
			{ type: "text", seq: 1, text: "seen" },
			{ type: "text", seq: 2, text: "fresh" },
			{ type: "done", seq: 2, status: "completed" },
		]);
		const { status, body } = await sse(`/agent/runs/${id}/stream?afterSeq=1`);
		expect(status).toBe(200);
		expect(body).not.toContain("seen");
		expect(body).toContain('"text":"fresh"');
		expect(body).toContain("event: done");
	});

	it("ends a settled run whose events are gone with a done of its own", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const id = (await repo.startRun(c.id, "hi", "auto")) as string;
		await repo.interruptIdle(c.id, id);
		const { body } = await sse(`/agent/runs/${id}/stream`);
		expect(body).toContain('"status":"interrupted"');
	}, 10_000);
});

describe("worker deps", () => {
	it("a job runs on the worker's deps although the module loaded before the db", async () => {
		const c = await repo.createConversation(undefined as never, "p1");
		const id = (await repo.startRun(c.id, "hi", "auto")) as string;
		const { approve: _, ...agent } = scripted([]).agent;
		const status = await job.executeRun(
			{ type: "start", conversationId: c.id, runId: id, userId: "u1", projectId: "p1", mode: "auto", message: "hi" },
			{ ...worker.deps, build: async () => agent },
			new AbortController().signal,
		);
		expect(status).toBe("completed");
		expect((await store.all(c.id)).map((r) => r.role)).toEqual(["user", "assistant"]);
		expect((await repo.getConversation(c.id))?.status).toBe("completed");
	});
});

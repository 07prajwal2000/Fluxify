import { afterAll, describe, expect, it, spyOn } from "bun:test";
import type { ModelMessage } from "ai";
import type { AgentStore, RunStatus } from "../store";
import type { AgentEvent } from "./events";
import {
	freshConversation,
	type OrphanDeps,
	releaseIfOrphaned,
	startHeartbeat,
	sweepOrphans,
} from "./orphans";
import * as repo from "./repository";

const STALE = 120_000;
type Run = { id: string; conversationId: string; status: RunStatus; updatedAt: Date };
const run = (id: string, status: RunStatus, ageMs = 0): Run => ({
	id,
	conversationId: `c-${id}`,
	status,
	updatedAt: new Date(Date.now() - ageMs),
});
const call = {
	role: "assistant",
	content: [{ type: "tool-call", toolCallId: "t1", toolName: "save_route", input: {} }],
} as ModelMessage;

/** The database and NATS in memory: run rows, who holds what, what settled and what went out. */
function world(runs: Run[], held: string[] = [], rows: ModelMessage[] = []) {
	const log = {
		settled: [] as unknown[][],
		sent: [] as AgentEvent[][],
		appended: [] as ModelMessage[],
		asked: [] as string[],
	};
	const deps: OrphanDeps = {
		staleMs: STALE,
		store: {
			modelView: async () => rows.map((message, seq) => ({ message, seq })),
			append: async (_c: string, _r: string, list: ModelMessage[]) => {
				log.appended.push(...list);
				return [];
			},
		} as unknown as AgentStore,
		held: async (id) => {
			log.asked.push(id);
			return held.includes(id);
		},
		claim: async (id) => {
			const r = runs.find((x) => x.id === id);
			if (r?.status !== "executing") return false;
			r.status = "interrupted";
			return true;
		},
		settle: async (...a) => void log.settled.push(a),
		publish: async (_id, e) => void log.sent.push(e),
		executing: async () => runs.filter((r) => r.status === "executing"),
	};
	return { deps, log, runs };
}

describe("releaseIfOrphaned", () => {
	it("an executing run with no heartbeat for the window is released: interrupted, conversation freed, stream ended", async () => {
		const w = world([run("r1", "executing", STALE + 1000)]);
		expect(await releaseIfOrphaned(w.runs[0], w.deps)).toBe(true);
		expect(w.runs[0].status).toBe("interrupted");
		expect(w.log.settled).toEqual([["c-r1", "r1", "interrupted", "restarted"]]);
		expect(w.log.sent).toEqual([
			[{ type: "done", seq: -1, status: "interrupted", reason: "restarted" }],
		]);
		// stale is enough: nobody is asked
		expect(w.log.asked).toEqual([]);
	});

	it("a fresh heartbeat that no worker holds (the gateway just died) is released too", async () => {
		const w = world([run("r1", "executing", 5000)]);
		expect(await releaseIfOrphaned(w.runs[0], w.deps)).toBe(true);
		expect(w.log.asked).toEqual(["r1"]);
	});

	it("a fresh heartbeat held by a live worker is left alone", async () => {
		const w = world([run("r1", "executing", 5000)], ["r1"]);
		expect(await releaseIfOrphaned(w.runs[0], w.deps)).toBe(false);
		expect(w.runs[0].status).toBe("executing");
		expect(w.log.settled).toEqual([]);
		expect(w.log.sent).toEqual([]);
	});

	it.each(["waiting_approval", "queued", "completed", "interrupted", "failed"] as const)(
		"%s is never touched, however old",
		async (status) => {
			const w = world([run("r1", status, STALE * 10)]);
			expect(await releaseIfOrphaned(w.runs[0], w.deps)).toBe(false);
			expect(w.runs[0].status).toBe(status);
			expect(w.log.settled).toEqual([]);
			expect(w.log.asked).toEqual([]);
		},
	);

	it("only one of two racing releases wins", async () => {
		const w = world([run("r1", "executing", STALE + 1000)]);
		const row = { ...w.runs[0] };
		const both = await Promise.all([releaseIfOrphaned(row, w.deps), releaseIfOrphaned(row, w.deps)]);
		expect(both.filter(Boolean)).toHaveLength(1);
		expect(w.log.settled).toHaveLength(1);
	});

	it("answers the calls the dead job left waiting, so the next message can run", async () => {
		const w = world([run("r1", "executing", STALE + 1000)], [], [call]);
		await releaseIfOrphaned(w.runs[0], w.deps);
		expect(w.log.appended).toHaveLength(1);
		expect(JSON.stringify(w.log.appended[0])).toContain("t1");
	});

	it("still frees the conversation when the done event cannot be published", async () => {
		const w = world([run("r1", "executing", STALE + 1000)]);
		w.deps.publish = async () => {
			throw new Error("nats down");
		};
		expect(await releaseIfOrphaned(w.runs[0], w.deps)).toBe(true);
		expect(w.log.settled).toHaveLength(1);
	});
});

describe("sweepOrphans", () => {
	it("releases stale and unheld runs; leaves fresh held, waiting and finished runs", async () => {
		const w = world(
			[
				run("stale", "executing", STALE + 1),
				run("dead", "executing", 1000),
				run("live", "executing", 1000),
				run("wait", "waiting_approval", STALE * 5),
				run("done", "completed", STALE * 5),
			],
			["live"],
		);
		expect(await sweepOrphans(w.deps)).toBe(2);
		expect(w.runs.map((r) => [r.id, r.status])).toEqual([
			["stale", "interrupted"],
			["dead", "interrupted"],
			["live", "executing"],
			["wait", "waiting_approval"],
			["done", "completed"],
		]);
	});

	it("one run failing does not stop the rest", async () => {
		const w = world([run("a", "executing", STALE + 1), run("b", "executing", STALE + 1)]);
		const claim = w.deps.claim;
		w.deps.claim = async (id) => {
			if (id === "a") throw new Error("db hiccup");
			return claim(id);
		};
		expect(await sweepOrphans(w.deps)).toBe(1);
		expect(w.runs[1].status).toBe("interrupted");
	});
});

describe("freshConversation", () => {
	const getRun = spyOn(repo, "getRun");
	const getConversation = spyOn(repo, "getConversation");
	afterAll(() => {
		getRun.mockRestore();
		getConversation.mockRestore();
	});
	const conv = (status: string) => ({ id: "c-r1", status, activeRunId: "r1" }) as never;

	it("returns the released conversation when its run lost its worker", async () => {
		const w = world([run("r1", "executing", STALE + 1)]);
		getRun.mockResolvedValue(w.runs[0] as never);
		getConversation.mockResolvedValue({ id: "c-r1", status: "interrupted" } as never);
		expect((await freshConversation(conv("running"), w.deps)).status).toBe("interrupted");
	});

	it("leaves a live run's conversation as it was", async () => {
		const w = world([run("r1", "executing", 1000)], ["r1"]);
		getRun.mockResolvedValue(w.runs[0] as never);
		const c = conv("running");
		expect(await freshConversation(c, w.deps)).toBe(c);
	});

	it.each(["idle", "paused_hitl", "interrupted", "completed"])(
		"a %s conversation is not even looked up",
		async (status) => {
			getRun.mockClear();
			const c = conv(status);
			expect(await freshConversation(c, world([]).deps)).toBe(c);
			expect(getRun).not.toHaveBeenCalled();
		},
	);
});

describe("startHeartbeat", () => {
	it("touches the run on every beat until stopped", async () => {
		let beats = 0;
		const stop = startHeartbeat(
			async () => ++beats > 0,
			() => {},
			5,
		);
		await Bun.sleep(40);
		stop();
		const seen = beats;
		expect(seen).toBeGreaterThanOrEqual(3);
		await Bun.sleep(30);
		expect(beats).toBe(seen);
	});

	it("tells the job when the run was released under it", async () => {
		let lost = 0;
		const stop = startHeartbeat(
			async () => false,
			() => lost++,
			5,
		);
		await Bun.sleep(30);
		stop();
		expect(lost).toBeGreaterThan(0);
	});

	it("a failed touch (db blip) is not a lost run", async () => {
		let lost = 0;
		const stop = startHeartbeat(
			async () => {
				throw new Error("db down");
			},
			() => lost++,
			5,
		);
		await Bun.sleep(30);
		stop();
		expect(lost).toBe(0);
	});
});

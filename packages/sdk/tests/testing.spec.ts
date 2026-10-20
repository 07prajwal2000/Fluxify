import { describe, expect, it } from "bun:test";
import { block, handle, param } from "../blocks.js";
import { manualTimer, memoryKv, memoryQueue, runBlock, testPool } from "../testing.js";

const agent = block({
	name: "acme/ai/agent",
	label: "Agent",
	invoke: ["sync"],
	handles: {
		out: [handle.out("source")],
		body: [handle.body("tools", "bottom-left", { allowMultiple: true }), handle.body("each", "top-left")],
	},
	async run({ input, executeHandle }) {
		return { output: { all: await executeHandle("tools", input), call: (x: unknown) => executeHandle("each", x) } };
	},
});

describe("runBlock", () => {
	it("records every handle call with its branch, input and result or error", async () => {
		const error = new Error("smtp down");
		const r = await runBlock(agent, {
			input: { q: 1 },
			handles: {
				tools: [
					{ label: "search", run: async () => ({ hits: [] }) },
					{ label: "email", run: async () => Promise.reject(error) },
				],
			},
		});
		expect(r.handleCalls).toEqual([
			{ handle: "tools", branch: "search", input: { q: 1 }, result: { hits: [] } },
			{ handle: "tools", branch: "email", input: { q: 1 }, error },
		]);
	});

	it("ends the run when it returns, unless keepAlive, which ends on end()", async () => {
		const each = { each: (x: unknown) => x };
		const done = await runBlock(agent, { handles: each });
		await expect((done.output as any).call(1)).rejects.toThrow("called after the run ended");

		const open = await runBlock(agent, { handles: each, keepAlive: true });
		expect(await (open.output as any).call(2)).toBe(2);
		open.end();
		await expect((open.output as any).call(3)).rejects.toThrow("called after the run ended");
		await expect(open.callAfterEnd("each", 1)).rejects.toThrow("executeHandle('each') called after the run ended");
	});

	it("rejects a stub for a handle the block does not have, or of the wrong shape", async () => {
		await expect(runBlock(agent, { handles: { nope: () => 1 } as any })).rejects.toThrow(
			"Block acme/ai/agent has no body handle 'nope'; body handles: tools, each",
		);
		await expect(runBlock(agent, { handles: { tools: () => 1 } as any })).rejects.toThrow(
			"handle 'tools' takes an array of { label, run }",
		);
	});

	it("asks for a schema param compiled, since the converter is the engine's", async () => {
		const def = block({ name: "acme/x/s", label: "S", params: { shape: param.schema() }, run: () => ({}) });
		const r = await runBlock(def, { params: { shape: { type: "object" } as any } });
		expect(r.error?.message).toBe("param 'shape' must be a compiled schema { zod, schema } (in a test, pass both)");
	});

	it("hands a queued call JSON only", async () => {
		const def = block({ name: "acme/x/q", label: "Q", run: ({ input }) => ({ output: input }) });
		const at = new Date(0);
		const r = await runBlock(def, { invoke: "queued", input: { at, fn: () => 1 } });
		expect(r.output).toEqual({ at: at.toISOString() });
	});
});

describe("ctx fakes", () => {
	const reach = (what: string) =>
		block({
			name: "acme/x/c",
			label: "C",
			permissions: { integrations: ["database"], appconfig: true },
			async run({ ctx }) {
				if (what === "db") await ctx.dbFactory!.getDbAdapter("c").count("t", []);
				if (what === "http") await ctx.httpClient!.get("https://x");
				if (what === "config") ctx.vars.getConfig("k");
				return {};
			},
		});

	it("throws `not stubbed` for db, http and app config unless given", async () => {
		for (const what of ["db", "http", "config"]) {
			const name = what === "config" ? "appconfig" : what;
			expect((await runBlock(reach(what))).error?.message).toStartWith(`not stubbed: ctx.${name}`);
		}
		const db = { count: async () => 3 } as any;
		const http = { get: async () => ({ data: 1, status: 200, headers: {} }) } as any;
		for (const what of ["db", "http", "config"])
			expect((await runBlock(reach(what), { ctx: { db, http, config: { k: 1 } } })).error).toBeUndefined();
	});

	it("memoryKv stores, expires and deletes; memoryQueue records what was sent", async () => {
		const kv = memoryKv();
		await kv.set("a", "1");
		await kv.setex("b", 0, "2");
		expect([await kv.get("a"), await kv.get("b")]).toEqual(["1", null]);
		await kv.delete("a");
		expect(kv.entries()).toEqual({});

		const queue = memoryQueue();
		const def = block({
			name: "acme/x/m",
			label: "M",
			permissions: { integrations: ["queue"] },
			async run({ ctx }) {
				const producer = await ctx.queueFactory!.getProducer("c");
				return { output: await producer.send([{ destination: "jobs", payload: 1 }]) };
			},
		});
		const r = await runBlock(def, { ctx: { queue } });
		expect(r.output).toEqual([{ index: 0, ok: true, result: {} }]);
		expect(queue.sent).toEqual([{ destination: "jobs", payload: 1 }]);
	});

	it("pool: reuses a client across runs, closes it once idle on the given clock", async () => {
		const timer = manualTimer();
		const pool = testPool({ timer });
		const closed: number[] = [];
		let made = 0;
		const def = block({
			name: "acme/x/p",
			label: "P",
			run: async ({ ctx }) => ({
				output: await ctx.pool("client", "key", { create: () => ++made, destroy: (n) => closed.push(n), idleMs: 1000 }),
			}),
		});
		expect((await runBlock(def, { ctx: { pool } })).output).toBe(1);
		expect((await runBlock(def, { ctx: { pool } })).output).toBe(1);
		expect(pool.getStats()).toEqual({ active: 1, retiring: 0, leases: 0 });
		timer.advance(999);
		expect(closed).toEqual([]);
		timer.advance(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(closed).toEqual([1]);
		expect((await runBlock(def, { ctx: { pool } })).output).toBe(2);
		await pool.close();
	});
});

// The block contract, written once and run against every way of running a
// block: `@fluxify/sdk/testing` (tests/conformance.spec.ts) and the real
// engine (packages/blocks/builtin/tests/conformance.spec.ts). A case that
// passes on one and fails on the other is drift. Workspace-only, never published.
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { block, handle, hint, param } from "../blocks.js";
import type { BlockDefinition } from "../src/block.js";
import type { KvAdapter } from "../src/context.js";
import type { InvokeMode } from "../src/reserved.js";
import type { BranchStub } from "../src/testing/runBlock.js";

export type ConformanceOptions = {
	params?: Record<string, unknown>;
	input?: unknown;
	invoke?: InvokeMode;
	handles?: Record<string, ((input: unknown) => unknown) | readonly BranchStub[]>;
	ctx?: { kv?: KvAdapter; config?: Record<string, string | number | boolean> };
};
/** a run, normalized: errors as messages, spans by name with their parent's name */
export type ConformanceResult = {
	handle?: string;
	output?: unknown;
	/** the message of what failed the run (not of a throw routed to `failure`) */
	error?: string;
	spans: { name: string; parent?: string; outcome: string; error?: string }[];
	logs: { level: string; value: unknown }[];
};
/** runs `def` once; rejects only for what the compiler rejects */
export type Runner = (
	def: BlockDefinition<any, any>,
	opts?: ConformanceOptions,
) => Promise<ConformanceResult>;

const T = "conf/test/block";
const branching = { out: [handle.out("success"), handle.out("failure")] } as const;
const tools = { out: [handle.out("source")], body: [handle.body("tools", "bottom-left", { allowMultiple: true }), handle.body("each", "top-left")] } as const;
const boom = () => {
	throw new Error("boom");
};

export function conformance(name: string, run: Runner) {
	describe(`${name}: params`, () => {
		const def = block({
			name: T,
			label: "P",
			invoke: ["sync"],
			params: {
				mode: param.select({ options: ["a", "b"], default: "a" }),
				channel: param.string({ required: true }),
				count: param.number(),
			},
			handles: branching,
			run: ({ params }) => ({ output: params }),
		});

		it("fills defaults and passes the rest through", async () => {
			const r = await run(def, { params: { channel: "#ops" } });
			expect(r).toMatchObject({ handle: "success", output: { mode: "a", channel: "#ops" } });
		});

		it("a missing required param goes to failure with its message", async () => {
			expect(await run(def, { params: {} })).toMatchObject({ handle: "failure", output: "param 'channel' is required" });
		});

		it("rejects a select value outside its options and a wrong type", async () => {
			const r = await run(def, { params: { channel: "#ops", mode: "c" } });
			expect(r.output).toBe(`param 'mode' must be one of a, b, got "c"`);
			const t = await run(def, { params: { channel: "#ops", count: "3" } });
			expect(t.output).toBe("param 'count' must be a number, got string");
		});

		it("hands a schema param over as { zod, schema }", async () => {
			const schema = { dataType: "object", properties: [{ key: "name", dataType: "str", required: true }] };
			const shaped = block({
				name: T,
				label: "S",
				params: { shape: param.schema() },
				run: ({ params }) => ({
					output: {
						schema: params.shape?.schema,
						ok: params.shape?.zod.safeParse({ name: "x" }).success,
						bad: params.shape?.zod.safeParse({}).success,
					},
				}),
			});
			const r = await run(shaped, { params: { shape: { zod: z.object({ name: z.string() }), schema } } });
			expect(r.output).toEqual({ schema, ok: true, bad: false });
		});
	});

	describe(`${name}: param values`, () => {
		const echo = (params: Record<string, any>) =>
			block({ name: T, label: "V", invoke: ["sync"], handles: branching, params, run: ({ params }) => ({ output: params }) });

		it("evaluates a js: string param against the input, and hands run a string", async () => {
			const def = echo({ who: param.string(), n: param.string(), code: param.js() });
			const r = await run(def, { params: { who: "js:return input.name", n: "js:return 40 + 2", code: "js:return input.name.length" }, input: { name: "Ada" } });
			expect(r).toMatchObject({ handle: "success", output: { who: "Ada", n: "42", code: 3 } });
			expect((await run(def, { params: { who: "plain" } })).output).toEqual({ who: "plain" });
		});

		it("keyValue: evaluates each value, and refuses an empty or repeated key", async () => {
			const def = echo({ headers: param.keyValue() });
			const r = await run(def, { params: { headers: { id: "js:return input.id", kind: "user", n: 2 } }, input: { id: 7 } });
			expect(r.output).toEqual({ headers: { id: 7, kind: "user", n: 2 } });
			expect((await run(def, { params: { headers: { "": 1 } } })).output).toBe("param 'headers' has an empty key");
			expect((await run(def, { params: { headers: { a: 1, "a ": 2 } } })).output).toBe("param 'headers' has the key 'a' twice");
		});

		it("array: evaluates each item, and holds min and max", async () => {
			const def = echo({ to: param.array({ min: 1, max: 2 }) });
			const r = await run(def, { params: { to: ["js:return input.a", "b"] }, input: { a: "x" } });
			expect(r.output).toEqual({ to: ["x", "b"] });
			expect((await run(def, { params: { to: [] } })).output).toBe("param 'to' needs at least 1 items, got 0");
			expect((await run(def, { params: { to: [1, 2, 3] } })).output).toBe("param 'to' takes at most 2 items, got 3");
		});

		it("fieldMap: maps the input like a Transformer does", async () => {
			const def = echo({ shape: param.fieldMap() });
			const r = await run(def, { params: { shape: { id: "userId", email: "email" } }, input: { id: 1, email: "a@b", x: 0 } });
			expect(r.output).toEqual({ shape: { userId: 1, email: "a@b" } });
		});

		it("a hint never reaches run, even when the canvas holds a value under its name", async () => {
			const def = echo({ note: hint("Read **this**."), who: param.string() });
			expect((await run(def, { params: { note: "x", who: "a" } })).output).toEqual({ who: "a" });
		});
	});

	describe(`${name}: result routing`, () => {
		const returning = (out: object, result: () => unknown) => block({ name: T, label: "R", invoke: ["sync"], handles: out as any, run: result as any });

		it("[source] leaves by source with the output", async () => {
			expect(await run(returning({ out: [handle.out("source")] }, () => ({ output: 1 })))).toMatchObject({ handle: "source", output: 1 });
		});

		it("[success, failure] takes success for no handle, failure with the output when returned", async () => {
			expect(await run(returning(branching, () => ({ output: 1 })))).toMatchObject({ handle: "success", output: 1 });
			expect(await run(returning(branching, () => ({ output: "no", handle: "failure" })))).toMatchObject({ handle: "failure", output: "no" });
		});

		it("a throw goes to failure with its message", async () => {
			const r = await run(returning(branching, boom));
			expect(r).toMatchObject({ handle: "failure", output: "boom" });
			expect(r.error).toBeUndefined();
		});

		it("a throw on a block without failure fails the run", async () => {
			const r = await run(returning({ out: [handle.out("source")] }, boom));
			expect(r.handle).toBeUndefined();
			expect(r.error).toBe("boom");
		});

		it("an undeclared returned handle fails the run, naming it", async () => {
			const r = await run(returning(branching, () => ({ handle: "maybe" })));
			expect(r.error).toBe(`Block ${T} returned unknown handle 'maybe'; expected: success, failure`);
		});

		it("[] ends with the output and no handle", async () => {
			const r = await run(returning({ out: [] }, () => ({ output: "done" })));
			expect([r.handle, r.output, r.error]).toEqual([undefined, "done", undefined]);
		});
	});

	describe(`${name}: body handles`, () => {
		const calling = (fn: (eh: any) => Promise<unknown>) =>
			block({ name: T, label: "B", invoke: ["sync"], handles: tools, run: async ({ executeHandle }) => ({ output: await fn(executeHandle) }) });
		const branches = (order: string[]): BranchStub[] =>
			order.map((label) => ({ label, run: (i) => (label === "email" ? boom() : `${label}:${i}`) }));

		it("single: runs its chain and resolves to what it ended with; unwired resolves undefined", async () => {
			const def = calling(async (eh) => [await eh("each", 2), await eh("each", 3)]);
			expect((await run(def, { handles: { each: (i) => (i as number) * 10 } })).output).toEqual([20, 30]);
			expect((await run(def)).output).toEqual([undefined, undefined]);
		});

		it("allowMultiple: every branch in order, a failure in its own slot", async () => {
			const def = calling(async (eh) => ((await eh("tools", 1)) as any[]).map((s) => (s?.error ? String(s.error) : s)));
			const r = await run(def, { handles: { tools: branches(["search", "email", "fetch"]) } });
			expect(r.output).toEqual(["search:1", "Error: boom", "fetch:1"]);
			expect((await run(def)).output).toEqual([]);
		});

		it("runs one branch by label and lists the branches", async () => {
			const def = calling(async (eh) => ({ one: await eh("tools", 5, { branch: "fetch" }), list: eh.branches("tools") }));
			const r = await run(def, { handles: { tools: branches(["search", "fetch"]) } });
			expect(r.output).toEqual({ one: "fetch:5", list: [{ id: "search", label: "search" }, { id: "fetch", label: "fetch" }] });
		});

		it("rejects an unknown branch, an unknown handle and a non-body handle", async () => {
			const def = (h: string, opts?: object) => calling((eh) => eh(h, 1, opts));
			expect((await run(def("tools", { branch: "nope" }), { handles: { tools: branches(["search"]) } })).error).toBe(
				`Block ${T} has no branch 'nope' on handle 'tools'`,
			);
			for (const h of ["nope", "source"])
				expect((await run(def(h))).error).toBe(`Block ${T} has no body handle '${h}'; body handles: tools, each`);
		});

		it("a call after the run ended rejects", async () => {
			const def = block({ name: T, label: "L", invoke: ["sync"], handles: tools, run: ({ executeHandle }) => ({ output: { call: (x: unknown) => executeHandle("each", x) } }) });
			const r = await run(def, { handles: { each: (i) => i } });
			await expect((r.output as any).call(1)).rejects.toThrow("executeHandle('each') called after the run ended");
		});
	});

	describe(`${name}: invoke`, () => {
		const plain = (extra: object = {}) => block({ name: T, label: "I", run: ({ input }) => ({ output: input }), ...extra });

		it("rejects a mode the block does not allow", async () => {
			await expect(run(plain({ invoke: ["sync"] }), { invoke: "queued" })).rejects.toThrow("cannot be invoked queued; allowed: sync");
		});

		// async/queued on a [success, failure] block: `block()` already rejects the definition
		it("rejects async on a block with a wired body handle", async () => {
			await expect(run(plain({ handles: tools }), { invoke: "async", handles: { each: () => 1 } })).rejects.toThrow(
				"has wired body handles, so it must be invoked sync, not async",
			);
		});
	});

	describe(`${name}: ctx`, () => {
		it("records spans with nesting and outcome, and logs", async () => {
			const def = block({
				name: T,
				label: "C",
				async run({ ctx }) {
					ctx.vars.logger.logInfo("start");
					await ctx.span("outer", () => ctx.span("inner", () => 1));
					await ctx.span("bad", boom).catch(() => ctx.vars.logger.logWarn("caught"));
					return { output: 1 };
				},
			});
			const r = await run(def);
			expect(r.spans).toEqual([
				{ name: "inner", parent: "outer", outcome: "success" },
				{ name: "outer", outcome: "success" },
				{ name: "bad", outcome: "failure", error: "boom" },
			]);
			expect(r.logs).toEqual([
				{ level: "info", value: "start" },
				{ level: "warn", value: "caught" },
			]);
		});

		it("reaches only the integrations and app config the block declared", async () => {
			const reach = (permissions: object) =>
				block({
					name: T,
					label: "G",
					permissions,
					async run({ ctx }) {
						const kv = ctx.kvFactory!.getKvAdapter("conn");
						await kv.set("k", "v");
						return { output: [await kv.get("k"), ctx.vars.getConfig("region")] };
					},
				});
			const kv = { store: new Map<string, string>() };
			const fake: KvAdapter = {
				get: async (k) => kv.store.get(k) ?? null,
				set: async (k, v) => void kv.store.set(k, v),
				setex: async () => {},
				delete: async () => {},
			};
			const ctx = { kv: fake, config: { region: "eu" } };
			expect((await run(reach({ integrations: ["kv"], appconfig: true }), { ctx })).output).toEqual(["v", "eu"]);
			expect((await run(reach({}), { ctx })).error).toContain("was not granted kv integrations");
			expect((await run(reach({ integrations: ["kv"] }), { ctx })).error).toContain("was not granted app config");
		});

		it("pools one client per key within a run, and retries a failed create", async () => {
			let made = 0;
			const def = block({
				name: T,
				label: "Pool",
				async run({ ctx }) {
					const opts = { create: (key: any) => ({ key, n: ++made }) };
					const a = await ctx.pool("k", { id: 1, x: 2 }, opts);
					const b = await ctx.pool("k", { x: 2, id: 1 }, opts);
					const failing = { create: () => (made++ === 1 ? boom() : "ok") };
					const err = await ctx.pool("bad", 1, failing).catch((e: Error) => e.message);
					return { output: { same: a === b, err, retried: await ctx.pool("bad", 1, failing) } };
				},
			});
			expect((await run(def)).output).toEqual({ same: true, err: "boom", retried: "ok" });
		});
	});
}

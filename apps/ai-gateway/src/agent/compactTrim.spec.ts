import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { compactor, trimOld } from "./compact";
import { keepSet } from "./trim";

const BIG = "x".repeat(4000);

type Out = { type: "text" | "json" | "error-text"; value: unknown };
/** One finished step: a call and its result. */
const step = (id: string, name: string, out: Out | string = BIG, input: object = {}): ModelMessage[] => [
	{ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: name, input }] },
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: id,
				toolName: name,
				output: (typeof out === "string" ? { type: "text", value: out } : out) as never,
			},
		],
	},
];
/** What each result of `ms` says, by tool call id. */
const seen = (ms: ModelMessage[]) =>
	Object.fromEntries(
		ms.flatMap((m) =>
			m.role === "tool"
				? m.content.flatMap((p) =>
						p.type === "tool-result"
							? [[p.toolCallId, JSON.stringify((p.output as { value: unknown }).value)]]
							: [],
					)
				: [],
		),
	);
const trimmed = (v: string) => v.includes("[result trimmed");
const user: ModelMessage = { role: "user", content: "go" };
const canvasOf = (...types: string[]) => ({
	type: "json" as const,
	value: { version: 3, blocks: types.map((type, i) => ({ key: `${type}_${i}`, type })), edges: [] },
});
const target = (id: string) => ({ target: { kind: "route", id } });

describe("trim by importance", () => {
	const all = [
		user,
		...step("rec", "get_recording"),
		...step("logs", "get_system_logs"),
		...step("list", "list", BIG, { type: "routes" }),
		...step("doc", "read_doc"),
		...step("route", "get_route"),
		...step("tail", "get_route"),
	];
	const from = all.length - 2;

	it("the first class goes first: recordings, logs, list_*, docs; the rest waits for level 1", () => {
		const a = seen(trimOld(all, from, { level: 0 }).messages);
		expect(["rec", "logs", "list", "doc"].map((id) => trimmed(a[id]))).toEqual([true, true, true, true]);
		expect(trimmed(a.route)).toBe(false);
		const b = trimOld(all, from, { level: 1 });
		expect(trimmed(seen(b.messages).route)).toBe(true);
		expect(b.tools).toEqual({
			get_recording: 1,
			get_system_logs: 1,
			list_routes: 1,
			read_doc: 1,
			get_route: 1,
		});
		expect(trimmed(seen(b.messages).tail)).toBe(false); // inside the last steps
	});

	it("never trims a call_route answer, a failing test, any tool error", () => {
		const failing = { type: "json" as const, value: { status: "failed", suites: [{ cases: [{ failedChecks: ["expected 409"] }] }] } };
		const passing = { type: "json" as const, value: { status: "passed", pad: BIG } };
		const ms = [
			user,
			...step("call", "call_route", { type: "json", value: { status: 409, body: BIG, error: "dup" } }),
			...step("fail", "run_test_suite", { ...failing, value: { ...failing.value, pad: BIG } }),
			...step("ok", "run_test_suite", passing),
			...step("err", "get_recording", { type: "error-text", value: BIG }),
			...step("tail", "get_route"),
		];
		const a = seen(trimOld(ms, ms.length - 2).messages);
		expect(["call", "fail", "err"].map((id) => trimmed(a[id]))).toEqual([false, false, false]);
		expect(trimmed(a.ok)).toBe(true); // a passing run is only a result
	});

	it("a huge result that is never trimmed keeps its head and tail", () => {
		const huge = "h".repeat(30_000);
		const ms = [user, ...step("call", "call_route", huge), ...step("tail", "get_route")];
		const v = seen(trimOld(ms, ms.length - 2).messages).call;
		expect(v.length).toBeLessThan(10_000);
		expect(v).toContain("chars trimmed");
		expect(v.startsWith('"hhh')).toBe(true);
	});

	it("keeps the newest canvas of each target, trims the older ones", () => {
		const ms = [
			user,
			...step("a1", "get_canvas", canvasOf("response"), target("a")),
			...step("b1", "get_canvas", canvasOf("response"), target("b")),
			...step("a2", "get_canvas", { ...canvasOf("response"), value: { ...canvasOf("response").value, pad: BIG } }, target("a")),
			...step("tail", "get_route"),
		];
		expect([...keepSet(ms)].sort()).toEqual(["a2", "b1"]);
		// the older canvas is small here, so the size guard keeps it; make it big to see it go
		const big = ms.map((m, i) => (i === 2 ? bigResult(m) : m));
		const a = seen(trimOld(big, big.length - 2, { keep: keepSet(big) }).messages);
		expect(trimmed(a.a1)).toBe(true);
		expect(trimmed(a.a2)).toBe(false);
		expect(trimmed(a.b1)).toBe(false);
	});

	it("keeps block schemas for types on the canvas, trims the ones that are not", () => {
		const ms = [
			user,
			...step("cv", "get_canvas", canvasOf("response", "if"), target("a")),
			...step("s1", "get_block_schemas", BIG, { blockTypes: ["response", "db_insert"] }),
			...step("s2", "get_block_schemas", BIG, { blockTypes: ["kv_get"] }),
			...step("s3", "get_block_schemas", BIG, {}),
			...step("add", "edit_canvas", "ok", { ...target("a"), ops: [{ op: "add_block", type: "db_native" }] }),
			...step("s4", "get_block_schemas", BIG, { blockTypes: ["db_native"] }),
			...step("tail", "get_route"),
		];
		const a = seen(trimOld(ms, ms.length - 2, { keep: keepSet(ms) }).messages);
		expect(["s1", "s4"].map((id) => trimmed(a[id]))).toEqual([false, false]);
		expect(["s2", "s3"].map((id) => trimmed(a[id]))).toEqual([true, true]);
	});

	it("same input, same output; the input is not changed", () => {
		const before = JSON.stringify(all);
		const keep = keepSet(all);
		const first = JSON.stringify(trimOld(all, from, { keep, level: 1 }));
		expect(JSON.stringify(trimOld(all, from, { keep, level: 1 }))).toBe(first);
		expect(JSON.stringify(all)).toBe(before);
	});
});

/** The result of a step's tool message grown to BIG. */
function bigResult(m: ModelMessage): ModelMessage {
	if (m.role !== "tool") return m;
	return {
		...m,
		content: m.content.map((p) =>
			p.type === "tool-result" ? { ...p, output: { type: "json" as const, value: { pad: BIG } } } : p,
		),
	};
}

describe("the batch", () => {
	const history = (): ModelMessage[] => [
		user,
		...step("rec", "get_recording"),
		...step("route1", "get_route"),
		...step("logs", "get_system_logs"),
		...step("route2", "get_route"),
		...step("t1", "get_route", "small"),
		...step("t2", "get_route", "small"),
		...step("t3", "get_route", "small"),
	];
	const model = {} as never;
	const prompt = async (context: number, used: number) => {
		const c = compactor({ model, history: history(), instructions: "", context });
		const a = await c.next({ inputTokens: used });
		const b = await c.next({ inputTokens: used });
		return { a, b, events: c.events };
	};

	it("stops at the first class when that is enough", async () => {
		// ~4k tokens of history; the first class is 2k of it; 50% of 6000 is 3000
		const r = await prompt(6000, 3700);
		const v = seen(r.a);
		expect([v.rec, v.logs].map(trimmed)).toEqual([true, true]);
		expect([v.route1, v.route2].map(trimmed)).toEqual([false, false]);
		expect(r.events).toHaveLength(1);
		expect(r.events[0]).toMatchObject({
			kind: "trim",
			results: 2,
			tools: { get_recording: 1, get_system_logs: 1 },
		});
	});

	it("goes on to the rest when the first class is not enough", async () => {
		const r = await prompt(3000, 2000);
		expect(Object.values(seen(r.a)).filter(trimmed)).toHaveLength(4);
		expect(r.events[0]).toMatchObject({ results: 4, tools: { get_route: 2 } });
		const e = r.events[0] as { before: number; after: number };
		expect(e.after).toBeLessThan(e.before);
	});

	it("freezes the class and the cut-off: the same prefix on the next step", async () => {
		const r = await prompt(6000, 3700);
		expect(JSON.stringify(r.b)).toBe(JSON.stringify(r.a));
		expect(r.events).toHaveLength(1);
	});
});

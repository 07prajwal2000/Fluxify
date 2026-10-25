import { describe, expect, it } from "bun:test";
import type { DbMeta } from "./dbOutputType";
import { createResolver, type InferOutput, resolveInputType } from "./resolveInputType";

const runner = (id: string, value: string) => ({ id, type: "jsrunner", data: { value } });
// the canvas names a handle `<blockId>-<kind>`
const edge = (source: string, target: string, kind: string | null = "source") => ({
	source,
	target,
	sourceHandle: kind && `${source}-${kind}`,
});

/** stands in for the TypeScript worker: the "type" is the script text itself */
const infer = async (source: string, input: string) => `${source}<${input}>`;

const users: DbMeta = {
	variant: "PostgreSQL",
	tables: [
		{
			table: "users",
			columns: [
				{ name: "id", type: "integer" },
				{ name: "name", type: "text" },
			],
		},
	],
};
const ctx = (inferOutput: InferOutput = infer, meta: DbMeta | null = users) => ({
	infer: inferOutput,
	loadDbMeta: async () => meta,
});
const dbBlock = (id: string, type: string, data: Record<string, unknown> = {}) => ({
	id,
	type,
	data: { connection: "c1", tableName: "users", ...data },
});

describe("resolveInputType", () => {
	it("is any with nothing wired in", async () => {
		expect(await resolveInputType("b", [runner("b", "x")], [], ctx())).toBe("any");
	});

	it("types input as the output of the JS Runner before it", async () => {
		const nodes = [runner("a", "A"), runner("b", "B")];

		expect(await resolveInputType("b", nodes, [edge("a", "b")], ctx())).toBe("A<any>");
	});

	it("feeds each runner's own input type down the chain", async () => {
		const nodes = [runner("a", "A"), runner("b", "B"), runner("c", "C")];
		const edges = [edge("a", "b"), edge("b", "c")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe("B<A<any>>");
	});

	it("takes the union when several blocks feed one", async () => {
		const nodes = [runner("a", "A"), runner("b", "B"), runner("c", "C")];
		const edges = [edge("a", "c"), edge("b", "c")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe("(A<any>) | (B<any>)");
	});

	it("is any when any block feeding it is not a typed JS Runner", async () => {
		const nodes = [runner("a", "A"), { id: "d", type: "kv_raw", data: {} }, runner("c", "C")];
		const edges = [edge("a", "c"), edge("d", "c")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe("any");
	});

	it("ignores output handles that do not carry the block's result", async () => {
		const nodes = [runner("a", "A"), runner("c", "C")];

		expect(await resolveInputType("c", nodes, [edge("a", "c", "executor")], ctx())).toBe("any");
	});

	it("cuts a cycle where it closes instead of hanging", async () => {
		const nodes = [runner("a", "A"), runner("b", "B")];
		const edges = [edge("a", "b"), edge("b", "a")];

		// a’s own input comes back round to b, so that leg is any
		expect(await resolveInputType("b", nodes, edges, ctx())).toBe("A<any>");
	});

	it("evaluates a runner once however many blocks read it", async () => {
		let calls = 0;
		const counting = async (source: string) => {
			calls++;
			return source;
		};
		const nodes = [runner("a", "A"), runner("b", "B"), runner("c", "C")];
		const edges = [edge("a", "b"), edge("a", "c"), edge("b", "c")];

		await resolveInputType("c", nodes, edges, ctx(counting));

		expect(calls).toBe(2);
	});

	it("types input as the row a DB Get Single returns, or null", async () => {
		const nodes = [dbBlock("d", "db_getsingle"), runner("c", "C")];

		expect(await resolveInputType("c", nodes, [edge("d", "c")], ctx())).toBe(
			"{ id: number; name: string; } | null",
		);
	});

	it("types input as a list of rows after DB Get All", async () => {
		const nodes = [dbBlock("d", "db_getall", { columns: ["name"] }), runner("c", "C")];

		expect(await resolveInputType("c", nodes, [edge("d", "c")], ctx())).toBe("({ name: string; })[]");
	});

	it("feeds a DB result into the script after it", async () => {
		const nodes = [dbBlock("d", "db_getall"), runner("a", "A"), runner("c", "C")];
		const edges = [edge("d", "a"), edge("a", "c")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe(
			"A<({ id: number; name: string; })[]>",
		);
	});

	it("falls back to an open row when the connection cannot be read", async () => {
		const nodes = [dbBlock("d", "db_getsingle"), runner("c", "C")];

		expect(await resolveInputType("c", nodes, [edge("d", "c")], ctx(infer, null))).toBe(
			"{ [key: string]: any } | null",
		);
	});

	it("types the other table blocks", async () => {
		const nodes = (type: string, data: Record<string, unknown> = {}) => [
			dbBlock("d", type, data),
			runner("c", "C"),
		];
		const next = (type: string, data?: Record<string, unknown>) =>
			resolveInputType("c", nodes(type, data), [edge("d", "c")], ctx());
		const row = "{ id: number; name: string; }";

		expect(await next("db_count")).toBe("number");
		expect(await next("db_insert")).toBe(row);
		expect(await next("db_insert", { onConflict: { action: "ignore" } })).toBe(`${row} | null`);
		expect(await next("db_insertbulk")).toBe(`(${row})[]`);
		expect(await next("db_update")).toBe(`{ count: number; affected: (${row})[] }`);
		expect(await next("db_delete")).toBe(`{ count: number; affected: (${row})[] }`);
	});

	it("types Row Exists: the row on success, its own input on failure", async () => {
		const nodes = [runner("a", "A"), dbBlock("e", "db_exists", { columns: ["id"] }), runner("c", "C")];
		const wired = (kind: string) => [edge("a", "e"), edge("e", "c", kind)];

		expect(await resolveInputType("c", nodes, wired("success"), ctx())).toBe("{ id: number; }");
		expect(await resolveInputType("c", nodes, wired("failure"), ctx())).toBe("A<any>");
	});

	it("types a DB Native script from what it returns", async () => {
		const nodes = [{ id: "n", type: "db_native", data: { js: "N" } }, runner("c", "C")];

		expect(await resolveInputType("c", nodes, [edge("n", "c")], ctx())).toBe("N<any>");
	});

	it("types a transaction: the chain's last output, or why it failed", async () => {
		const nodes = [
			{ id: "t", type: "db_transaction", data: {} },
			dbBlock("i", "db_insert"),
			dbBlock("g", "db_count"),
			runner("c", "C"),
		];
		const edges = [edge("t", "i", "executor"), edge("i", "g"), edge("t", "c", "success")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe("number");
		expect(
			await resolveInputType("c", nodes, [edge("t", "c", "failure")], ctx()),
		).toBe('{ reason: "rollback" | "error" | "timeout"; message: string }');
	});

	it("gives a block inside a transaction the transaction's own input", async () => {
		const nodes = [runner("a", "A"), { id: "t", type: "db_transaction", data: {} }, runner("c", "C")];
		const edges = [edge("a", "t"), edge("t", "c", "executor")];

		expect(await resolveInputType("c", nodes, edges, ctx())).toBe("A<any>");
	});

	const block = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data });
	/** what a JS Runner "c" wired to block "x" by `kind` sees as input */
	const after = (x: ReturnType<typeof block>, kind = "source", before: ReturnType<typeof block>[] = []) =>
		resolveInputType(
			"c",
			[...before, x, runner("c", "C")],
			[...before.map((b) => edge(b.id, x.id)), edge(x.id, "c", kind)],
			ctx(),
		);

	it("hands on what a pass-through block received", async () => {
		const a = [runner("a", "A")];

		for (const [type, kind] of [
			["if", "success"],
			["if", "failure"],
			["switch", "case"],
			["consolelog", "source"],
			["cloud_logs", "source"],
			["httpsetheader", "source"],
			["httpsetcookie", "source"],
			["trigger_workflow", "source"],
		]) {
			expect(await after(block("p", type), kind, a)).toBe("A<any>");
		}
	});

	it("types a trigger workflow set to Later as its run handle", async () => {
		expect(await after(block("w", "trigger_workflow", { mode: "later" }))).toBe(
			"{ id: string; runAt: string }",
		);
	});

	it("types the fixed-shape blocks", async () => {
		expect(await after(block("h", "httprequest"))).toBe("{ data: any; status: number }");
		expect(await after(block("h", "httpgetheader"))).toBe("string");
		expect(await after(block("h", "httpgetparam", { mode: "multiple" }))).toBe("string[]");
		expect(await after(block("h", "error_handler"))).toBe("string");
		expect(await after(block("h", "arrayops"))).toBe("any[]");
	});

	it("types a KV Raw script and a JS Transformer", async () => {
		expect(await after(block("k", "kv_raw", { js: "K" }))).toBe("K<any>");
		expect(await after(block("t", "transformer", { useJs: true, js: "T" }))).toBe("T<any>");
	});

	it("types a retry like a transaction", async () => {
		const retry = block("r", "retry");
		const nodes = [retry, dbBlock("g", "db_count"), runner("c", "C")];
		const wired = (kind: string) => [edge("r", "g", "executor"), edge("r", "c", kind)];

		expect(await resolveInputType("c", nodes, wired("success"), ctx())).toBe("number");
		expect(await resolveInputType("c", nodes, [...wired("failure")].slice(1), ctx())).toBe(
			"{ attempts: number; message: string }",
		);
	});

	it("gives each round of a loop its item, and the code after it nothing", async () => {
		const list = dbBlock("d", "db_getall", { columns: ["id"] });
		const loop = (data: Record<string, unknown>) => block("l", "foreachloop", data);
		const body = (l: ReturnType<typeof block>, before: unknown[]) =>
			resolveInputType("c", [...before, l, runner("c", "C")] as never, [edge("d", "l"), edge("l", "c", "executor")], ctx());

		expect(await body(loop({ useParam: true }), [list])).toBe("(({ id: number; })[])[number]");
		expect(await body(loop({ useParam: false }), [list])).toBe("any");
		expect(await after(block("f", "forloop"), "executor")).toBe("number");
		expect(await after(block("f", "forloop"), "source")).toBe("undefined");
		expect(await after(block("f", "foreachloop"), "source")).toBe("undefined");
	});

	it("gives each orchestrator branch the orchestrator's input", async () => {
		const a = [runner("a", "A")];

		expect(await after(block("o", "orchestrator"), "orchestrate", a)).toBe("A<any>");
	});

	it("types a field-map Transformer from the keys it maps", async () => {
		const t = block("t", "transformer", { fieldMap: { id: "userId", "e-mail": "email" } });

		expect(await after(t)).toBe('{ "userId": any; "email": any; }');
		expect(await after(t, "source", [runner("a", "A")])).toBe(
			'{ "userId": (A<any>)["id"]; "email": (A<any>)["e-mail"]; }',
		);
		expect(await after(block("t", "transformer", { fieldMap: {} }))).toBe("{}");
	});

	it("types KV Operations as untyped, passing writes through", async () => {
		const a = [runner("a", "A")];

		expect(await after(block("k", "kv_operations", { operation: "get" }), "source", a)).toBe("any");
		expect(await after(block("k", "kv_operations", { operation: "set" }), "source", a)).toBe("A<any>");
		expect(
			await after(block("k", "kv_operations", { operation: "get", keepResult: true }), "source", a),
		).toBe("{ input: A<any>; result: any }");
		expect(
			await after(block("k", "kv_operations", { operation: "delete", keepResult: true })),
		).toBe("{ input: any; result: boolean }");
	});

	it("types Get Request Body from getRequestBody()", async () => {
		expect(await after(block("b", "httpgetrequestbody"))).toBe("ReturnType<typeof getRequestBody>");
	});

	it("types Send Message with every broker's fields, optional", async () => {
		const send = block("q", "queue_send");
		const fields = ["topic?: string", "seq?: number", "queueUrl?: string", "sent?:", "error?: string"];

		for (const kind of ["success", "failure"]) {
			const type = await after(send, kind);
			for (const field of fields) expect(type).toContain(field);
		}
		expect(await after(block("q", "queue_send", { mode: "raw", js: "Q" }), "success")).toBe("Q<any>");
	});

	it("types Set Var from its value and hands that on", async () => {
		const set = (value: unknown) => after(block("s", "setvar", { key: "k", value }));

		expect(await set("hello")).toBe("string");
		expect(await set(3)).toBe("number");
		expect(await set(true)).toBe("boolean");
		expect(await set({ a: 1 })).toBe("any");
		expect(await set("js:return input.id")).toBe("return input.id<any>");
		expect(
			await after(
				block("s", "setvar", { mode: "multiple", items: [{ key: "a", value: 1 }, { key: "b", value: "x" }] }),
			),
		).toBe("[number, string]");
	});

	it("types Get Var as whatever sets the variable, even from another branch", async () => {
		const nodes = [
			block("s1", "setvar", { key: "total", value: 1 }),
			block("s2", "setvar", { key: "total", value: "x" }),
			block("s3", "setvar", { key: "name", value: "n" }),
			block("g", "getvar", { key: "total" }),
			runner("c", "C"),
		];
		const resolve = (g: ReturnType<typeof block>) =>
			resolveInputType("c", nodes.map((n) => (n.id === "g" ? g : n)), [edge("g", "c")], ctx());

		expect(await resolve(block("g", "getvar", { key: "total" }))).toBe("(number) | (string)");
		expect(await resolve(block("g", "getvar", { key: "name" }))).toBe("string");
		expect(await resolve(block("g", "getvar", { key: "never" }))).toBe("any");
		expect(
			await resolve(block("g", "getvar", { mode: "multiple", items: [{ key: "name" }, { key: "total" }] })),
		).toBe("[string, (number) | (string)]");
	});

	it("does not hang on a variable that depends on itself", async () => {
		const nodes = [
			block("s", "setvar", { key: "loop", value: "js:return x" }),
			block("g", "getvar", { key: "loop" }),
			runner("c", "C"),
		];
		const edges = [edge("g", "s"), edge("s", "c")];

		expect(typeof (await resolveInputType("c", nodes, edges, ctx()))).toBe("string");
	});

	it("types an orchestrator's result as a tuple, in its order, settling to strings", async () => {
		const nodes = [
			runner("a", "A"),
			block("o", "orchestrator", { order: ["y", "x"] }),
			dbBlock("x", "db_count"),
			runner("y", "Y"),
			runner("c", "C"),
		];
		const wired = [edge("a", "o"), edge("o", "x", "orchestrate"), edge("o", "y", "orchestrate"), edge("o", "c")];

		expect(await resolveInputType("c", nodes, wired, ctx())).toBe("[Y<A<any>>, number]");
		const settle = nodes.map((n) => (n.id === "o" ? block("o", "orchestrator", { onError: "settle" }) : n));
		expect(await resolveInputType("c", settle, wired, ctx())).toBe("[(number) | string, (Y<A<any>>) | string]");
	});

	it("shares a resolver's work: the saved outputs and variables of a canvas", async () => {
		const nodes = [dbBlock("d", "db_count"), block("s", "setvar", { key: "k", value: 1 })];
		const resolver = createResolver(nodes, [], ctx());

		expect(await resolver.outputType("d")).toBe("number");
		expect(await resolver.setVarType("s", 0)).toBe("number");
	});

	it("leaves a variable any when a script writes it too", async () => {
		const nodes = [
			block("s", "setvar", { key: "total", value: 1 }),
			runner("w", "total = 'x'"),
			block("g", "getvar", { key: "total" }),
			runner("c", "C"),
		];

		expect(await resolveInputType("c", nodes, [edge("g", "c")], ctx())).toBe("any");
	});
});

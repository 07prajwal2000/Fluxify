import { describe, expect, it } from "bun:test";
import type { DbMeta } from "./dbOutputType";
import { type InferOutput, resolveInputType } from "./resolveInputType";

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
});

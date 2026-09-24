import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasEdge } from "../types";
import { SHARED_CHAIN, transactionTopologyKey, validateTransactions } from "./transactionValidator";

const b = (id: string, type: string): CanvasBlock => ({ id, type, data: {}, position: { x: 0, y: 0 } });
const e = (from: string, to: string, handle = "source"): CanvasEdge => ({
	id: `${from}-${to}`,
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});
const flagged = (blocks: CanvasBlock[], edges: CanvasEdge[]) =>
	validateTransactions({ blocks, edges }).map((d) => d.blockId);

const base = [b("in", "entrypoint"), b("tx", "db_transaction"), b("if", "if"), b("rb", "db_rollback")];

describe("validateTransactions", () => {
	it("accepts a rollback wired under a transaction's executor", () => {
		expect(flagged(base, [e("in", "tx"), e("tx", "if", "executor"), e("if", "rb", "failure")])).toEqual([]);
	});

	it("flags a rollback reachable without a transaction", () => {
		expect(flagged(base, [e("in", "tx"), e("tx", "if", "success"), e("if", "rb", "failure")])).toEqual([
			"rb",
		]);
	});

	it("flags a rollback when any one path escapes the transaction", () => {
		const edges = [e("in", "tx"), e("tx", "if", "executor"), e("if", "rb"), e("in", "rb")];
		expect(flagged(base, edges)).toEqual(["rb"]);
	});

	it("stays quiet for an unwired rollback", () => {
		expect(flagged(base, [e("in", "tx")])).toEqual([]);
	});

	it("errors when success or failure leads into the executor chain", () => {
		const blocks = [...base, b("log", "consolelog")];
		const shared = validateTransactions({
			blocks,
			edges: [e("in", "tx"), e("tx", "if", "executor"), e("if", "log"), e("tx", "log", "failure")],
		});
		expect(shared).toEqual([
			{ blockId: "tx", severity: "error", message: SHARED_CHAIN, source: "transaction-wiring" },
		]);
		// reached further down the executor chain counts too
		expect(flagged(blocks, [e("tx", "if", "executor"), e("if", "log"), e("tx", "log", "success")])).toEqual(["tx"]);
	});

	it("allows success and failure to share blocks outside the executor chain", () => {
		const blocks = [...base, b("log", "consolelog")];
		const edges = [e("in", "tx"), e("tx", "if", "executor"), e("tx", "log", "success"), e("tx", "log", "failure")];
		expect(flagged(blocks, edges)).toEqual([]);
	});

	it("keys only on wiring, and is empty without a rollback", () => {
		const graph = { blocks: base, edges: [e("in", "tx")] };
		const moved = { blocks: base.map((x) => ({ ...x, position: { x: 9, y: 9 } })), edges: graph.edges };
		expect(transactionTopologyKey(graph)).toBe(transactionTopologyKey(moved));
		expect(transactionTopologyKey({ blocks: [b("in", "entrypoint"), b("if", "if")], edges: graph.edges })).toBe("");
	});
});

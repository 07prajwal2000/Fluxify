import { describe, expect, it } from "bun:test";
import { assertTransactionWiring } from "../transactionWiring";

const tx = (id: string, connection = "db1") => ({
	id,
	type: "db_transaction",
	data: { blockName: id.toUpperCase(), connection },
});
const block = (id: string, type = "jsrunner") => ({ id, type, data: {} });
const edge = (from: string, to: string, handle = "source") => ({
	from,
	to,
	fromHandle: `${from}-${handle}`,
});

describe("assertTransactionWiring", () => {
	it("refuses a nested transaction on the same connection", () => {
		const blocks = [block("in", "entrypoint"), tx("outer"), tx("inner")];
		const edges = [edge("in", "outer"), edge("outer", "inner", "executor")];
		expect(() => assertTransactionWiring(blocks, edges)).toThrow(
			'Transaction "INNER" (inner): it runs inside another transaction on the same connection, which is not supported.',
		);
	});

	it("refuses a success/failure path leading into the executor chain", () => {
		const blocks = [block("in", "entrypoint"), tx("outer"), block("step")];
		const edges = [edge("in", "outer"), edge("outer", "step", "executor"), edge("outer", "step", "failure")];
		expect(() => assertTransactionWiring(blocks, edges)).toThrow("its executor chain also runs");
	});

	it("saves nested transactions on different connections and a stray rollback", () => {
		const blocks = [block("in", "entrypoint"), tx("outer"), tx("inner", "db2"), block("rb", "db_rollback")];
		const edges = [edge("in", "outer"), edge("outer", "inner", "executor"), edge("in", "rb")];
		expect(() => assertTransactionWiring(blocks, edges)).not.toThrow();
	});
});

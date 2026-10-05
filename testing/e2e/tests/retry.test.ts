import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

const order = await loadGraph("retry/order");
const rollbackInTx = await loadGraph("retry/rollback-in-transaction");

beforeEach(() => resetDatabase("pg"));

/** the seed has three orders; a failed try that left its row behind shows up here */
async function orderCount() {
	const { sql } = await database();
	const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders`;
	return count;
}

const times = (executed: string[], id: string) => executed.filter((e) => e === id).length;

describe("retry/order", () => {
	it("succeeds on the first try without retrying", async () => {
		const run = await runGraph(order, { body: { user_id: 2, total: 50, failFor: 0 } });

		expect(run.status).toBe(201);
		expect(run.body).toMatchObject({ user_id: 2, total: "50.00", status: "pending" });
		expect(times(run.executed, "insert-order")).toBe(1);
		expect(await orderCount()).toBe(4);
	});

	it("rolls back each failed try and commits the one that works", async () => {
		const run = await runGraph(order, { body: { user_id: 2, total: 50, failFor: 2 } });

		expect(run.status).toBe(201);
		expect(run.body).toMatchObject({ user_id: 2, total: "50.00" });
		// three inserts ran, two were undone — only one order is left
		expect(times(run.executed, "insert-order")).toBe(3);
		expect(await orderCount()).toBe(4);
	});

	it("runs failure with attempts and the last error once every try failed", async () => {
		const run = await runGraph(order, { body: { user_id: 2, total: 50, failFor: 5 } });

		expect(run.status).toBe(503);
		expect(run.body.attempts).toBe(3);
		expect(run.body.message).toContain("flaky try 3");
		expect(await orderCount()).toBe(3);
	});
});

describe("retry/rollback-in-transaction", () => {
	it("does not retry a rollback and undoes the insert once", async () => {
		const run = await runGraph(rollbackInTx);

		expect(run.status).toBe(409);
		expect(run.body).toEqual({ reason: "rollback", message: "changed my mind" });
		expect(times(run.executed, "insert-order")).toBe(1);
		expect(await orderCount()).toBe(3);
	});
});

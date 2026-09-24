import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

const fixture = await loadGraph("place-order");
const nested = await loadGraph("nested-transaction");

beforeEach(() => resetDatabase("pg"));

/** the seed has three orders; anything else means a transaction leaked or lost a row */
async function orderCount() {
	const { sql } = await database();
	const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders`;
	return count;
}

describe("place-order", () => {
	it("commits the order and hands the executor chain's last output to success", async () => {
		const run = await runGraph(fixture, { body: { user_id: 2, total: 50 } });

		expect(run.status).toBe(201);
		expect(run.body).toMatchObject({ user_id: 2, total: "50.00", status: "pending" });
		expect(run.executed).not.toContain("rollback");
		expect(await orderCount()).toBe(4);
	});

	it("undoes the insert on a rollback block and runs failure", async () => {
		const run = await runGraph(fixture, { body: { user_id: 2, total: 5000 } });

		expect(run.status).toBe(409);
		expect(run.body).toEqual({ reason: "rollback", message: "order total 5000.00 is over the limit" });
		// the row was really inserted before the rollback — the count proves it was undone
		expect(run.executed).toContain("insert-order");
		expect(run.executed).toContain("rollback");
		expect(await orderCount()).toBe(3);
	});

	it("runs failure with the database error instead of failing the route", async () => {
		const run = await runGraph(fixture, { body: { user_id: 999, total: 50 } });

		expect(run.status).toBe(409);
		expect(run.body.reason).toBe("error");
		expect(run.body.message).toContain("foreign key");
		expect(await orderCount()).toBe(3);
	});
});

describe("nested-transaction", () => {
	it("refuses the inner transaction and rolls back the outer one's insert", async () => {
		const run = await runGraph(nested);

		expect(run.status).toBe(409);
		expect(run.body).toEqual({
			reason: "error",
			message: "nested transactions on the same connection are not supported",
		});
		expect(run.executed).toContain("insert-order");
		expect(run.executed).not.toContain("insert-again");
		expect(await orderCount()).toBe(3);
	});
});

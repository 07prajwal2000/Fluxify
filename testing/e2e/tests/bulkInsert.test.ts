import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph, type GraphFixture } from "../src/graph";
import type { Engine } from "../src/engines";
import { mongo } from "../src/mongo";
import { mysql } from "../src/mysql";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

/**
 * #510: a bulk insert with `useTransaction` is all-or-nothing. Every case here
 * is built to break that — a failure in the last chunk, parallel chains on one
 * connection, an outer transaction, wide rows, repeated failures.
 */
const allOrNothing = await loadGraph("bulk-insert/all-or-nothing");
const parallel = await loadGraph("bulk-insert/parallel");
const inTransaction = await loadGraph("bulk-insert/in-transaction");
const wide = await loadGraph("bulk-insert/wide");
const mongoAllOrNothing = await loadGraph("bulk-insert/mongo-all-or-nothing");
const mongoInTransaction = await loadGraph("bulk-insert/mongo-in-transaction");

type SqlEngine = Extract<Engine, "pg" | "mysql">;

async function count(engine: SqlEngine, table: string, where = "1 = 1") {
	const query = `SELECT count(*) AS n FROM ${table} WHERE ${where}`;
	if (engine === "mysql") {
		const [rows] = await (await mysql()).pool.query(query);
		return Number((rows as { n: number }[])[0].n);
	}
	const [{ n }] = await (await database()).sql.unsafe(query);
	return Number(n);
}

/** the Postgres graphs assert on row counts only, so they run as-is on MySQL */
const on = (engine: SqlEngine, fixture: GraphFixture): GraphFixture => ({ ...fixture, engine });

/** the same graph as a saved one that predates the checkbox */
function withoutTransactionFlag(fixture: GraphFixture): GraphFixture {
	return {
		...fixture,
		blocks: fixture.blocks.map((b) => {
			if (b.type !== "db_insertbulk") return b;
			const { useTransaction, ...data } = b.data as Record<string, unknown>;
			return { ...b, data };
		}) as GraphFixture["blocks"],
	};
}

// seed: 3 users, 3 orders
for (const engine of ["pg", "mysql"] as const) {
describe(`bulk insert on ${engine}`, () => {
	beforeEach(() => resetDatabase(engine));

	it("inserts every row across chunks", async () => {
		const run = await runGraph(on(engine, allOrNothing), { body: { count: 1500, prefix: "ok" } });

		expect(run.status).toBe(201);
		expect(run.body).toHaveLength(1500);
		expect(await count(engine, "users")).toBe(1503);
	});

	it("leaves nothing behind when the last chunk fails", async () => {
		const run = await runGraph(on(engine, allOrNothing), {
			body: { count: 1500, prefix: "fail", duplicateLast: true },
		});

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(run.executed).not.toContain("created");
		expect(await count(engine, "users")).toBe(3);
	});

	it("keeps the first chunk for a saved graph without the flag, as before", async () => {
		const run = await runGraph(on(engine, withoutTransactionFlag(allOrNothing)), {
			body: { count: 1500, prefix: "old", duplicateLast: true },
		});

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(await count(engine, "users")).toBe(1003);
	});

	it("doesn't leak a connection per failure", async () => {
		// the pool holds 10; a leaked reserved connection per failure hangs the 11th
		for (let i = 0; i < 15; i++) {
			const run = await runGraph(on(engine, allOrNothing), {
				body: { count: 3, prefix: `leak${i}-`, duplicateLast: true },
			});
			expect(run.status).toBeGreaterThanOrEqual(400);
		}
		const run = await runGraph(on(engine, allOrNothing), { body: { count: 2, prefix: "after" } });
		expect(run.status).toBe(201);
		expect(await count(engine, "users")).toBe(5);
	});

	it("keeps parallel chains on one connection apart", async () => {
		const run = await runGraph(on(engine, parallel), { body: { count: 1500 } });

		expect(run.status).toBe(200);
		expect(run.executed).toEqual(
			expect.arrayContaining(["insert-good", "insert-order", "done"]),
		);
		// good chain: all in; bad chain: nothing; plain insert: not rolled back with the bad chain
		expect(await count(engine, "users")).toBe(1503);
		expect(await count(engine, "users", "email LIKE 'bad%'")).toBe(0);
		expect(await count(engine, "orders")).toBe(4);
	});

	it("joins an outer transaction instead of committing on its own", async () => {
		const run = await runGraph(on(engine, inTransaction), { body: { count: 1500, prefix: "tx" } });

		expect(run.status).toBe(409);
		expect(run.body).toEqual({ reason: "rollback", message: "undo the bulk insert" });
		expect(run.executed).toContain("insert");
		expect(await count(engine, "users")).toBe(3);
	});

	it("sizes chunks by every column the rows use, not the first row", async () => {
		const run = await runGraph(on(engine, wide));

		expect(run.status).toBe(201);
		expect(run.body).toHaveLength(2000);
		expect(await count(engine, "wide")).toBe(2000);
	});
});
}

describe("bulk insert on MongoDB", () => {
	beforeEach(() => resetDatabase("mongo"));

	const emails = async () => (await mongo()).db.collection("emails").countDocuments();

	it("leaves nothing behind when a document fails", async () => {
		const run = await runGraph(mongoAllOrNothing, {
			body: { count: 50, prefix: "m", duplicateLast: true },
		});

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(await emails()).toBe(1);
	});

	it("inserts every document", async () => {
		const run = await runGraph(mongoAllOrNothing, { body: { count: 50, prefix: "m" } });

		expect(run.status).toBe(201);
		expect(run.body).toHaveLength(50);
		expect(await emails()).toBe(51);
	});

	it("joins an outer transaction instead of committing on its own", async () => {
		const run = await runGraph(mongoInTransaction, { body: { count: 50, prefix: "tx" } });

		expect(run.status).toBe(409);
		expect(run.executed).toContain("insert");
		expect(await emails()).toBe(1);
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import { type Engine, resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

/** #513: query timeouts, transaction timeouts and deadlock retries */
const slowQuery = await loadGraph("timeouts/slow-query");
const transactionTimeout = await loadGraph("timeouts/transaction-timeout");
const deadlock = await loadGraph("timeouts/deadlock");

/** the same graph with one block's data changed */
function withData(fixture: GraphFixture, id: string, data: Record<string, unknown>): GraphFixture {
	return {
		...fixture,
		blocks: fixture.blocks.map((b) =>
			b.id === id ? { ...b, data: { ...(b.data as object), ...data } } : b,
		) as GraphFixture["blocks"],
	};
}

/** each engine's two-second query */
const SLOW: Record<Exclude<Engine, "none" | "pg">, string> = {
	// SLEEP alone is not an error when interrupted; reading rows through it is
	mysql: 'return await dbQuery("SELECT SLEEP(2) FROM users");',
	mongo:
		'const db = await dbQuery();\nreturn await db.collection("todos").find({ $where: "sleep(2000) || true" }).toArray();',
};

/** what each engine says when it stops the query */
const STOPPED: Record<Exclude<Engine, "none">, RegExp> = {
	pg: /canceling statement due to statement timeout/,
	mysql: /maximum statement execution time exceeded/,
	mongo: /Timed out/,
};

async function orderCount() {
	const { sql } = await database();
	const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders`;
	return count;
}

describe("query timeout", () => {
	for (const engine of ["pg", "mysql", "mongo"] as const) {
		it(`stops a slow query on ${engine}`, async () => {
			await resetDatabase(engine);
			const fixture =
				engine === "pg" ? slowQuery : { ...withData(slowQuery, "slow", { js: SLOW[engine] }), engine };
			const started = Date.now();
			const run = await runGraph(fixture);

			expect(run.status).toBe(409);
			expect(run.body.message).toMatch(STOPPED[engine]);
			expect(Date.now() - started).toBeLessThan(1800);
		});
	}
});

describe("transaction timeout", () => {
	beforeEach(() => resetDatabase("pg"));

	it("rolls back, refuses the late insert and runs failure with reason timeout", async () => {
		const run = await runGraph(transactionTimeout);

		expect(run.status).toBe(409);
		expect(run.body).toEqual({ reason: "timeout", message: "transaction timed out after 300ms" });
		expect(await orderCount()).toBe(3);
		// the executor chain is still sleeping; once it wakes, its insert must be refused
		await Bun.sleep(900);
		expect(await orderCount()).toBe(3);
	});
});

describe("deadlock retry", () => {
	beforeEach(() => resetDatabase("pg"));

	const both = (fixture: GraphFixture) =>
		Promise.all([
			runGraph(fixture, { body: { first: 1, second: 2 } }),
			runGraph(fixture, { body: { first: 2, second: 1 } }),
		]);

	it("retries the deadlocked transaction until both commit", async () => {
		const runs = await both(deadlock);
		expect(runs.map((r) => r.status)).toEqual([200, 200]);
	});

	it("fails the loser without retries", async () => {
		const runs = await both(withData(deadlock, "tx", { retries: 0 }));
		const statuses = runs.map((r) => r.status).sort();
		expect(statuses).toEqual([200, 409]);
		const loser = runs.find((r) => r.status === 409)!;
		expect(loser.body.reason).toBe("error");
		expect(loser.body.message).toContain("deadlock");
	});
});

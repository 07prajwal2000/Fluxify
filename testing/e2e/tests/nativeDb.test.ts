import { describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { mongo } from "../src/mongo";
import { runGraph } from "../src/runner";

/** #514: the DB Native block on each engine */
const inTransaction = await loadGraph("native/in-transaction");
const globals = await loadGraph("native/globals");

/** the same graph with one block's code changed */
function withJs(fixture: GraphFixture, id: string, js: string): GraphFixture {
	return {
		...fixture,
		blocks: fixture.blocks.map((b) =>
			b.id === id ? { ...b, data: { ...(b.data as object), js } } : b,
		) as GraphFixture["blocks"],
	};
}

const todos = async () => (await mongo()).db.collection("todos").countDocuments();

describe("native MongoDB in a transaction", () => {
	it("rolls back the native insert when the transaction fails", async () => {
		await resetDatabase("mongo");
		const before = await todos();

		const run = await runGraph(inTransaction, { body: { undo: true } });

		expect(run.status).toBe(409);
		expect(run.body.message).toContain("undo");
		expect(await todos()).toBe(before);
	});

	it("commits the insert, and reads it back inside the transaction", async () => {
		await resetDatabase("mongo");
		const before = await todos();

		const run = await runGraph(inTransaction, { body: { undo: false } });

		expect(run.status).toBe(200);
		expect(run.body).toEqual({ readBack: true });
		expect(await todos()).toBe(before + 1);
	});

	it("refuses dbQuery with a pointer to db", async () => {
		await resetDatabase("mongo");
		const run = await runGraph(withJs(inTransaction, "work", 'return await dbQuery("SELECT 1");'));

		expect(run.status).toBe(409);
		expect(run.body.message).toContain("dbQuery takes SQL; on MongoDB use db.collection(...)");
	});
});

describe("native globals", () => {
	it("keeps a graph variable named dbQuery", async () => {
		await resetDatabase("pg");
		const run = await runGraph(globals);

		expect(run.status).toBe(200);
		expect(run.body).toEqual({ result: [{ a: 7, b: 7 }], dbQuery: "mine" });
	});

	it("takes $1 placeholders on MySQL, repeated and out of order, and still takes ?", async () => {
		await resetDatabase("mysql");
		const js =
			'const [r] = await dbQuery("SELECT $2 AS a, $1 AS b, $1 AS c, \'$1\' AS lit", [1, 2]);\nconst [q] = await dbQuery("SELECT ? AS q", [5]);\nreturn { ...r, q: q.q };';
		const run = await runGraph({ ...withJs(globals, "run", js), engine: "mysql" });

		expect(run.status).toBe(200);
		expect(run.body.result).toEqual({ a: 2, b: 1, c: 1, lit: "$1", q: 5 });
	});
});

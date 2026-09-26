import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #505: db_count. Table, column and value come from the request body, so
 * these cases send what a caller could — including input built to break it.
 */
const rows = await loadGraph("count/rows");

const on = (engine: Engine, fixture: GraphFixture = rows): GraphFixture => ({ ...fixture, engine });

/** the same graph with extra data on the count block (joins) */
function withCount(data: Record<string, unknown>, engine: Engine): GraphFixture {
	return on(engine, {
		...rows,
		blocks: rows.blocks.map((b) =>
			b.id === "count" ? { ...b, data: { ...(b.data as object), ...data } } : b,
		) as GraphFixture["blocks"],
	});
}

const count = (fixture: GraphFixture, body: Record<string, unknown>) =>
	runGraph(fixture, { body });

// seed: users Ada (active), Grace (active), Alan (inactive); orders 2 for Ada, 1 for Grace
for (const engine of ["pg", "mysql"] as const) {
	describe(`count on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("counts every row when the value is left out", async () => {
			const run = await count(on(engine), { table: "users", column: "active" });

			expect(run.status).toBe(200);
			expect(run.body).toBe(3);
		});

		it("counts matching rows as a number, not a bigint string", async () => {
			const run = await count(on(engine), { table: "users", column: "active", value: true });

			expect(run.body).toBe(2);
		});

		it("returns 0, not an error, when nothing matches", async () => {
			const run = await count(on(engine), { table: "users", column: "email", value: "nobody@x.io" });

			expect(run.status).toBe(200);
			expect(run.body).toBe(0);
		});

		it("counts joined rows", async () => {
			const joined = withCount(
				{ joins: [{ table: "orders", attribute: "users.id = orders.user_id", type: "inner" }] },
				engine,
			);
			const run = await count(joined, { table: "users", column: "users.active", value: true });

			expect(run.body).toBe(3);
		});

		it("binds a quote-laden value instead of running it", async () => {
			const run = await count(on(engine), {
				table: "users",
				column: "email",
				value: "x' OR '1'='1",
			});

			expect(run.body).toBe(0);
		});

		it("treats a table name with SQL in it as a name, and leaves the table alone", async () => {
			const run = await count(on(engine), {
				table: "users; DROP TABLE orders; --",
				column: "active",
			});

			expect(run.status).toBeGreaterThanOrEqual(400);
			const after = await count(on(engine), { table: "orders", column: "status" });
			expect(after.body).toBe(3);
		});

		it("treats a column with SQL in it as a name, not an always-true filter", async () => {
			const run = await count(on(engine), {
				table: "users",
				column: "email = email OR 1 = 1 --",
				value: "nobody@x.io",
			});

			expect(run.status).toBeGreaterThanOrEqual(400);
		});

		it("fails on a table that doesn't exist instead of counting 0", async () => {
			const run = await count(on(engine), { table: "no_such_table", column: "active" });

			expect(run.status).toBeGreaterThanOrEqual(400);
			expect(run.executed).not.toContain("reply");
		});

		it("fails on a column that doesn't exist instead of counting 0", async () => {
			const run = await count(on(engine), { table: "users", column: "nope", value: 1 });

			expect(run.status).toBeGreaterThanOrEqual(400);
			expect(run.executed).not.toContain("reply");
		});
	});
}

// seed: todos 1 done, 3 pending, 1 archived
describe("count on MongoDB", () => {
	beforeEach(() => resetDatabase("mongo"));

	it("counts matching documents", async () => {
		const run = await count(on("mongo"), { table: "todos", column: "status", value: "pending" });

		expect(run.status).toBe(200);
		expect(run.body).toBe(3);
	});

	it("counts every document when the value is left out", async () => {
		const run = await count(on("mongo"), { table: "todos", column: "status" });

		expect(run.body).toBe(5);
	});

	it("returns 0 for a collection that doesn't exist", async () => {
		// Mongo has no schema: a missing collection is an empty one
		const run = await count(on("mongo"), { table: "no_such_collection", column: "status" });

		expect(run.status).toBe(200);
		expect(run.body).toBe(0);
	});

	it("ignores joins instead of failing", async () => {
		const joined = withCount(
			{ joins: [{ table: "emails", attribute: "todos.title = emails.name", type: "inner" }] },
			"mongo",
		);
		const run = await count(joined, { table: "todos", column: "status", value: "pending" });

		expect(run.status).toBe(200);
		expect(run.body).toBe(3);
	});

	it("matches an operator object from the body literally, not as a query", async () => {
		// { status: { $ne: null } } would match every document
		const run = await count(on("mongo"), {
			table: "todos",
			column: "status",
			value: { $ne: null },
		});

		expect(run.status).toBe(200);
		expect(run.body).toBe(0);
	});

	it("treats a bad id as a plain value instead of throwing", async () => {
		const run = await count(on("mongo"), { table: "todos", column: "id", value: "not-an-object-id" });

		expect(run.status).toBe(200);
		expect(run.body).toBe(0);
	});
});

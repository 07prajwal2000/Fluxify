import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { mongo } from "../src/mongo";
import { mysql } from "../src/mysql";
import { database } from "../src/postgres";
import { type GraphRun, runGraph } from "../src/runner";

/**
 * #501: db_insert / db_insertbulk with onConflict. Seed: `users` (pg, mysql) and
 * `emails` (mongo) both hold ada@example.com under a unique email.
 */
const single = await loadGraph("upsert/single");
const bulk = await loadGraph("upsert/bulk");

type OnConflict = { target: string[]; action: "update" | "ignore"; update?: string[] };

/** the fixture on another engine and conflict setting; Mongo's collection is `emails` */
function variant(fixture: GraphFixture, engine: Engine, onConflict: OnConflict): GraphFixture {
	return {
		...fixture,
		engine,
		blocks: fixture.blocks.map((b) =>
			b.id === "upsert"
				? { ...b, data: { ...b.data, onConflict, ...(engine === "mongo" && { tableName: "emails" }) } }
				: b,
		) as GraphFixture["blocks"],
	};
}

/** every row with this email, as the database has it */
async function rows(engine: Engine, email: string): Promise<{ name: string }[]> {
	if (engine === "mongo") return (await mongo()).db.collection("emails").find({ email }).toArray() as any;
	if (engine === "mysql") {
		const [r] = await (await mysql()).pool.query("SELECT * FROM users WHERE email = ?", [email]);
		return r as { name: string }[];
	}
	return (await database()).sql`SELECT * FROM users WHERE email = ${email}`;
}

const update: OnConflict = { target: ["email"], action: "update" };
const ignore: OnConflict = { target: ["email"], action: "ignore" };
const ada = "ada@example.com";

/** the upsert block's own span: a null result would reach the client wrapped by the response block */
const upsertSpan = (run: GraphRun) => run.spans.find((s) => s.blockId === "upsert")!;

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`upsert on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("inserts a new row", async () => {
			const run = await runGraph(variant(single, engine, update), {
				body: { row: { name: "New", email: "new@x.io" } },
			});

			expect(run.status).toBe(200);
			expect(run.body).toMatchObject({ name: "New", email: "new@x.io" });
			expect(await rows(engine, "new@x.io")).toHaveLength(1);
		});

		it("updates the row with the same key", async () => {
			const run = await runGraph(variant(single, engine, update), {
				body: { row: { name: "Ada King", email: ada } },
			});

			expect(run.body).toMatchObject({ name: "Ada King", email: ada });
			const stored = await rows(engine, ada);
			expect(stored).toHaveLength(1);
			expect(stored[0].name).toBe("Ada King");
		});

		it("ignore skips the duplicate and returns nothing", async () => {
			const run = await runGraph(variant(single, engine, ignore), {
				body: { row: { name: "Imposter", email: ada } },
			});

			expect(run.status).toBe(200);
			expect(upsertSpan(run).output).toBeNull();
			expect((await rows(engine, ada))[0].name).not.toBe("Imposter");
		});

		it("bulk: updates existing rows and inserts new ones", async () => {
			const run = await runGraph(variant(bulk, engine, update), {
				body: {
					rows: [
						{ name: "Ada King", email: ada },
						{ name: "B", email: "b@x.io" },
					],
				},
			});

			expect(run.status).toBe(200);
			expect(run.body.map((r: { email: string }) => r.email).sort()).toEqual([ada, "b@x.io"]);
			expect((await rows(engine, ada))[0].name).toBe("Ada King");
			expect(await rows(engine, "b@x.io")).toHaveLength(1);
		});

		it("bulk ignore returns only the rows it inserted", async () => {
			const run = await runGraph(variant(bulk, engine, ignore), {
				body: {
					rows: [
						{ name: "Imposter", email: ada },
						{ name: "B", email: "b@x.io" },
					],
				},
			});

			expect(run.body.map((r: { email: string }) => r.email)).toEqual(["b@x.io"]);
			expect((await rows(engine, ada))[0].name).not.toBe("Imposter");
		});

		it("parallel upserts of one new key leave one row", async () => {
			const runs = await Promise.all(
				Array.from({ length: 5 }, (_, i) =>
					runGraph(variant(single, engine, update), {
						body: { row: { name: `Racer ${i}`, email: "race@x.io" } },
					}),
				),
			);

			expect(runs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
			expect(await rows(engine, "race@x.io")).toHaveLength(1);
		});
	});
}

for (const engine of ["pg", "mysql"] as const) {
	describe(`upsert columns on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("overwrites only the listed columns", async () => {
			const run = await runGraph(
				variant(single, engine, { ...update, update: ["name"] }),
				{ body: { row: { name: "Ada King", email: ada, active: false } } },
			);

			expect(run.status).toBe(200);
			const [stored] = (await rows(engine, ada)) as { name: string; active: unknown }[];
			expect(stored.name).toBe("Ada King");
			expect(Boolean(stored.active)).toBe(true);
		});
	});
}

describe("upsert errors on pg", () => {
	beforeEach(() => resetDatabase("pg"));

	it("names the missing unique index", async () => {
		const run = await runGraph(variant(single, "pg", { target: ["name"], action: "update" }), {
			body: { row: { name: "Ada Lovelace", email: "x@x.io" } },
		});

		expect(run.status).toBeGreaterThanOrEqual(400);
		const error = upsertSpan(run).error as Error;
		expect((error.cause as Error).message).toContain(
			"needs a unique index or constraint on (name)",
		);
	});

	it("rejects one key twice in a bulk update, as Postgres does", async () => {
		const run = await runGraph(variant(bulk, "pg", update), {
			body: {
				rows: [
					{ name: "One", email: "dup@x.io" },
					{ name: "Two", email: "dup@x.io" },
				],
			},
		});

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(await rows("pg", "dup@x.io")).toHaveLength(0);
	});
});

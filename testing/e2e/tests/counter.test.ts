import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { mongo } from "../src/mongo";
import { mysql } from "../src/mysql";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

/**
 * #501 follow-up: `{ op: "inc" | "dec", value }` adds in the database, so runs that overlap
 * both count. Seed: `counters` holds views = 5, unique by name, on every engine.
 */
const update = await loadGraph("counter/update");
const upsertSingle = await loadGraph("upsert/single");
const upsertBulk = await loadGraph("upsert/bulk");

/** the fixture on another engine, with its db block's data merged in */
function variant(fixture: GraphFixture, engine: Engine, data: Record<string, unknown>) {
	return {
		...fixture,
		engine,
		blocks: fixture.blocks.map((b) =>
			b.id === "hit" || b.id === "upsert" ? { ...b, data: { ...b.data, ...data } } : b,
		),
	} as GraphFixture;
}

const counters = { tableName: "counters" };
const upsert = { ...counters, onConflict: { target: ["name"], action: "update" } };

async function hits(engine: Engine, name: string): Promise<number[]> {
	if (engine === "mongo") {
		const docs = await (await mongo()).db.collection("counters").find({ name }).toArray();
		return docs.map((d) => d.hits);
	}
	if (engine === "mysql") {
		const [r] = await (await mysql()).pool.query("SELECT hits FROM counters WHERE name = ?", [name]);
		return (r as { hits: number }[]).map((x) => x.hits);
	}
	const rows = await (await database()).sql`SELECT hits FROM counters WHERE name = ${name}`;
	return rows.map((x: { hits: number }) => x.hits);
}

const inc = (value: unknown) => ({ op: "inc", value });

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`inc / dec on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("parallel increments all apply", async () => {
			const runs = await Promise.all(
				Array.from({ length: 10 }, () =>
					runGraph(variant(update, engine, {}), { body: { name: "views", by: 2 } }),
				),
			);

			expect(runs.every((r) => r.status === 200)).toBe(true);
			expect(await hits(engine, "views")).toEqual([25]);
		});

		it("dec subtracts", async () => {
			const graph = variant(update, engine, {
				data: { source: "raw", value: { hits: { op: "dec", value: 3 } } },
			});
			await runGraph(graph, { body: { name: "views" } });

			expect(await hits(engine, "views")).toEqual([2]);
		});

		it("rejects an amount that is not a number", async () => {
			const run = await runGraph(variant(update, engine, {}), { body: { name: "views", by: "1; DROP" } });

			expect(run.status).toBeGreaterThanOrEqual(400);
			const error = run.spans.find((s) => s.blockId === "hit")!.error as Error;
			expect((error.cause as Error).message).toBe('inc on "hits" needs a number, got "1; DROP"');
			expect(await hits(engine, "views")).toEqual([5]);
		});

		it("upsert adds to an existing row", async () => {
			const run = await runGraph(variant(upsertSingle, engine, upsert), {
				body: { row: { name: "views", hits: inc(10) } },
			});

			expect(run.status).toBe(200);
			expect(await hits(engine, "views")).toEqual([15]);
		});

		it("upsert starts a new row at the amount", async () => {
			await runGraph(variant(upsertSingle, engine, upsert), {
				body: { row: { name: "likes", hits: { op: "dec", value: 4 } } },
			});

			expect(await hits(engine, "likes")).toEqual([-4]);
		});

		it("parallel upserts of a new key all count", async () => {
			const runs = await Promise.all(
				Array.from({ length: 5 }, () =>
					runGraph(variant(upsertSingle, engine, upsert), {
						body: { row: { name: "shares", hits: inc(1) } },
					}),
				),
			);

			expect(runs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
			expect(await hits(engine, "shares")).toEqual([5]);
		});

		it("bulk upsert: existing rows add, new rows start", async () => {
			const run = await runGraph(variant(upsertBulk, engine, upsert), {
				body: {
					rows: [
						{ name: "views", hits: inc(1) },
						{ name: "likes", hits: inc(7) },
					],
				},
			});

			expect(run.status).toBe(200);
			expect(await hits(engine, "views")).toEqual([6]);
			expect(await hits(engine, "likes")).toEqual([7]);
		});
	});
}

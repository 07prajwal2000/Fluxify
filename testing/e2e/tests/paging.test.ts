import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { mongo } from "../src/mongo";
import { mysql } from "../src/mysql";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";

/**
 * #508: no hidden 1000-row cap, checked limit/offset, and cursor paging.
 *
 * Seed (`PEOPLE`), in insert (= key) order:
 *   1 Ada Lovelace     red   36
 *   2 Grace Hopper     blue  85
 *   3 100% Real_Name\  red   41
 *   4 C++ (dev) [x].*  blue  18
 *   5 Ghost            red   (no age)
 */
const people = await loadGraph("conditions/people");

const ADA = "Ada Lovelace";
const GRACE = "Grace Hopper";
const PCT = "100% Real_Name\\";
const PLUS = "C++ (dev) [x].*";
const GHOST = "Ghost";

type Sort = { attribute: string; direction: "asc" | "desc" };
const asc = (attribute: string): Sort => ({ attribute, direction: "asc" });
const desc = (attribute: string): Sort => ({ attribute, direction: "desc" });

function withData(engine: Engine, data: Record<string, unknown>): GraphFixture {
	return {
		...people,
		engine,
		blocks: people.blocks.map((b) =>
			b.id === "find" ? { ...b, data: { ...(b.data as object), conditions: [], ...data } } : b,
		) as GraphFixture["blocks"],
	};
}

type Page = { rows: Record<string, unknown>[]; nextCursor: string | null };

/** one cursor page; the cursor comes from the body, as a graph would pass it back */
async function page(engine: Engine, data: Record<string, unknown>, after?: string | null) {
	const run = await runGraph(
		withData(engine, { paging: "cursor", after: "js:return getRequestBody().after;", ...data }),
		{ body: { after } },
	);
	expect(run.status).toBe(200);
	return run.body as Page;
}

/** every page until nextCursor runs out; `between` runs after each page */
async function walk(
	engine: Engine,
	data: Record<string, unknown>,
	between: (pageNo: number) => Promise<void> = async () => {},
) {
	const names: string[] = [];
	let after: string | null = null;
	for (let pageNo = 0; pageNo < 100; pageNo++) {
		const current = await page(engine, data, after);
		names.push(...current.rows.map((r) => r.name as string));
		if (!current.nextCursor) return names;
		after = current.nextCursor;
		await between(pageNo);
	}
	throw new Error("cursor never ran out");
}

/** rows straight into `people`, bypassing the graph */
async function insertPeople(engine: Engine, rows: { name: string; team: string; age: number | null }[]) {
	if (engine === "mongo") {
		await (await mongo()).db.collection("people").insertMany(rows.map((r) => ({ ...r })));
		return;
	}
	if (engine === "mysql") {
		const values = rows.map((r) => [r.name, r.team, r.age]);
		await (await mysql()).pool.query("INSERT INTO people (name, team, age) VALUES ?", [values]);
		return;
	}
	const { sql } = await database();
	await sql`INSERT INTO people ${sql(rows, "name", "team", "age")}`;
}

const many = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ name: `bulk ${i}`, team: "green", age: i % 90 }));

/** where each database puts a null age when sorting ascending */
const NULLS_FIRST = { pg: false, mysql: true, mongo: true } as const;

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`get-all paging on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		describe("limit", () => {
			it("returns more than 1000 rows when asked", async () => {
				await insertPeople(engine, many(1200));
				const run = await runGraph(withData(engine, { limit: 1100 }));
				expect(run.status).toBe(200);
				expect(run.body).toHaveLength(1100);
			});

			it("-1 returns every row", async () => {
				await insertPeople(engine, many(1200));
				const run = await runGraph(withData(engine, { limit: -1, offset: 3 }));
				expect(run.status).toBe(200);
				expect(run.body).toHaveLength(1205 - 3);
			});

			it("takes limit and offset from query text", async () => {
				const run = await runGraph(
					withData(engine, {
						limit: "js:return getRequestBody().limit;",
						offset: "js:return getRequestBody().offset;",
					}),
					{ body: { limit: "2", offset: "1" } },
				);
				expect((run.body as { name: string }[]).map((r) => r.name)).toEqual([GRACE, PCT]);
			});

			for (const [limit, offset, message] of [
				["abc", 0, 'limit must be a whole number ≥ 1, or -1 for no limit, got "abc"'],
				[10, -1, "offset must be a whole number ≥ 0, got -1"],
			] as const) {
				it(`fails clearly on limit ${limit}, offset ${offset}`, async () => {
					const run = await runGraph(
						withData(engine, {
							limit: "js:return getRequestBody().limit;",
							offset: "js:return getRequestBody().offset;",
						}),
						{ body: { limit, offset } },
					);
					expect(run.status).toBe(500);
					expect(run.body).toEqual({ error: `Error: ${message}` });
				});
			}
		});

		describe("cursor", () => {
			it("walks every row once, in order, across ties", async () => {
				const names = await walk(engine, { sort: [asc("team")], limit: 2 });
				expect(names).toEqual([GRACE, PLUS, ADA, PCT, GHOST]);
			});

			it("returns { rows, nextCursor } and no cursor on the last page", async () => {
				const first = await page(engine, { limit: 3 });
				expect(first.rows).toHaveLength(3);
				expect(typeof first.nextCursor).toBe("string");
				const last = await page(engine, { limit: 3 }, first.nextCursor);
				expect(last.rows.map((r) => r.name)).toEqual([PLUS, GHOST]);
				expect(last.nextCursor).toBeNull();
			});

			it("a page exactly at the end has no next cursor", async () => {
				expect((await page(engine, { limit: 5 })).nextCursor).toBeNull();
			});

			it("mixed directions", async () => {
				const names = await walk(engine, { sort: [desc("team"), asc("name")], limit: 1 });
				expect(names).toEqual([PCT, ADA, GHOST, PLUS, GRACE]);
			});

			it("walks past nulls without skipping them", async () => {
				const byAge = [PLUS, ADA, PCT, GRACE];
				const nullsFirst = NULLS_FIRST[engine];
				expect(await walk(engine, { sort: [asc("age")], limit: 1 })).toEqual(
					nullsFirst ? [GHOST, ...byAge] : [...byAge, GHOST],
				);
				expect(await walk(engine, { sort: [desc("age")], limit: 2 })).toEqual(
					nullsFirst ? [...byAge.reverse(), GHOST] : [GHOST, ...byAge.reverse()],
				);
			});

			it("sorts by a JSON path, nulls included", async () => {
				// London / london: MySQL and Mongo compare case differently, so compare to offset mode
				const sort = [asc("profile.city")];
				const all = await runGraph(withData(engine, { sort, limit: 100 }));
				const expected = (all.body as { name: string }[]).map((r) => r.name);
				expect(expected).toHaveLength(5);
				expect(await walk(engine, { sort, limit: 1 })).toEqual(expected);
			});

			it("rows added while paging: no repeats, no gaps", async () => {
				// sorted by age; pages 2-4 each add a row behind the cursor (age 1, once
				// the walk is past Ghost's null on nulls-first databases) and one ahead
				const names = await walk(engine, { sort: [asc("age")], limit: 1 }, async (pageNo) => {
					if (pageNo < 1 || pageNo > 3) return;
					await insertPeople(engine, [
						{ name: `behind ${pageNo}`, team: "new", age: 1 },
						{ name: `ahead ${pageNo}`, team: "new", age: 200 },
					]);
				});
				expect(new Set(names).size).toBe(names.length);
				expect(names.filter((x) => !x.startsWith("behind") && !x.startsWith("ahead"))).toEqual(
					NULLS_FIRST[engine] ? [GHOST, PLUS, ADA, PCT, GRACE] : [PLUS, ADA, PCT, GRACE, GHOST],
				);
				// rows added behind the cursor stay behind it; rows added ahead are all reached
				expect(names.filter((x) => x.startsWith("behind"))).toEqual([]);
				expect(names.filter((x) => x.startsWith("ahead"))).toEqual(["ahead 1", "ahead 2", "ahead 3"]);
			});

			it("works when Columns leaves the sort columns out, and hides its own", async () => {
				const first = await page(engine, { columns: ["name"], sort: [desc("age")], limit: 2 });
				for (const row of first.rows) {
					expect(Object.keys(row).filter((k) => k !== "id")).toEqual(["name"]);
				}
				const rest = await page(
					engine,
					{ columns: ["name"], sort: [desc("age")], limit: 10 },
					first.nextCursor,
				);
				expect([...first.rows, ...rest.rows].map((r) => r.name)).toHaveLength(5);
			});

			it("uses the tiebreaker columns given, in order", async () => {
				const names = await walk(engine, { sort: [asc("team")], keys: ["name"], limit: 2 });
				expect(names).toEqual([PLUS, GRACE, PCT, ADA, GHOST]);
			});

			it("ignores offset", async () => {
				const first = await page(engine, { limit: 2, offset: 3 });
				expect(first.rows.map((r) => r.name)).toEqual([ADA, GRACE]);
			});

			it("-1 returns every row with no cursor", async () => {
				const all = await page(engine, { limit: -1 });
				expect(all.rows).toHaveLength(5);
				expect(all.nextCursor).toBeNull();
			});

			it("refuses a cursor that was not handed out", async () => {
				const run = await runGraph(withData(engine, { paging: "cursor", after: "garbage", limit: 2 }));
				expect(run.status).toBe(500);
				const error = run.spans.find((s) => s.blockId === "find")!.error as Error;
				expect((error.cause as Error).message).toContain("after is not a cursor");
			});
		});
	});
}

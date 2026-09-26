import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #500: the in / null / text / between / exists operators. Column and value
 * come from the request body, so each case sends what a caller could — and
 * most of them send what a caller should not. One graph must answer the same
 * on every database, so the shared cases assert one result for all three.
 *
 * Seed (`PEOPLE`): Ada Lovelace, Grace Hopper (nickname null),
 * "100% Real_Name\", "C++ (dev) [x].*", Ghost (everything but the name null —
 * on Mongo, missing).
 */
const people = await loadGraph("conditions/people");

const ADA = "Ada Lovelace";
const GRACE = "Grace Hopper";
const PCT = "100% Real_Name\\";
const PLUS = "C++ (dev) [x].*";
const GHOST = "Ghost";
const EVERYONE = [ADA, GRACE, PCT, PLUS, GHOST];

type Condition = { column?: unknown; operator: string; value?: unknown; chain?: string };

/** the graph with its conditions replaced; column and value default to the body's */
function withConditions(engine: Engine, conditions: Condition[]): GraphFixture {
	return {
		...people,
		engine,
		blocks: people.blocks.map((b) =>
			b.id === "find"
				? {
						...b,
						data: {
							...(b.data as object),
							conditions: conditions.map((c) => ({
								attribute: {
									kind: "column",
									value: c.column ?? "js:return getRequestBody().column;",
								},
								operator: c.operator,
								value: c.value ?? {
									kind: "literal",
									value: "js:return getRequestBody().value;",
								},
								chain: c.chain ?? "and",
							})),
						},
					}
				: b,
		) as GraphFixture["blocks"],
	};
}

async function find(engine: Engine, operator: string, body: Record<string, unknown>) {
	return runGraph(withConditions(engine, [{ operator }]), { body });
}

/** the names a run returned, sorted so the database's row order does not matter */
const names = (run: { body: unknown }) =>
	(run.body as { name: string }[]).map((row) => row.name).sort();

const sorted = (list: string[]) => [...list].sort();

/** a condition the adapter refuses fails the block; nothing is answered */
function expectRefused(run: { status: number; executed: string[] }) {
	expect(run.status).toBeGreaterThanOrEqual(400);
	expect(run.executed).not.toContain("reply");
}

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`conditions on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		describe("in / not_in", () => {
			it("matches an array from the body", async () => {
				const run = await find(engine, "in", { column: "name", value: [ADA, GRACE] });

				expect(run.status).toBe(200);
				expect(names(run)).toEqual(sorted([ADA, GRACE]));
			});

			it("splits comma-separated text and trims each item", async () => {
				const run = await find(engine, "in", { column: "name", value: ` ${ADA} ,${GRACE},, ` });

				expect(names(run)).toEqual(sorted([ADA, GRACE]));
			});

			it("matches nothing for an empty list instead of sending IN ()", async () => {
				const run = await find(engine, "in", { column: "name", value: [] });

				expect(run.status).toBe(200);
				expect(names(run)).toEqual([]);
			});

			it("matches nothing for blank text", async () => {
				const run = await find(engine, "in", { column: "name", value: " , " });

				expect(names(run)).toEqual([]);
			});

			it("matches everyone for an empty not_in", async () => {
				const run = await find(engine, "not_in", { column: "name", value: [] });

				expect(names(run)).toEqual(sorted(EVERYONE));
			});

			it("leaves nulls out of not_in, the same on every database", async () => {
				// Mongo's $nin alone would also return Grace (null) and Ghost (missing)
				const run = await find(engine, "not_in", { column: "nickname", value: ["ada"] });

				expect(names(run)).toEqual(sorted([PCT, PLUS]));
			});

			it("skips the filter when the value is left out", async () => {
				const run = await find(engine, "in", { column: "name" });

				expect(names(run)).toEqual(sorted(EVERYONE));
			});

			it("refuses a null in the list instead of the NOT IN (…, NULL) trap", async () => {
				expectRefused(await find(engine, "not_in", { column: "name", value: [ADA, null] }));
			});

			it("refuses a bare null list", async () => {
				expectRefused(await find(engine, "in", { column: "name", value: null }));
			});

			it("refuses an operator object smuggled into the list", async () => {
				// on Mongo, { $ne: null } inside $in must never widen the match
				expectRefused(await find(engine, "in", { column: "name", value: [{ $ne: null }] }));
			});

			it("refuses a nested list", async () => {
				expectRefused(await find(engine, "in", { column: "name", value: [[ADA]] }));
			});

			it("binds quote-laden items instead of running them", async () => {
				const run = await find(engine, "in", {
					column: "name",
					value: ["x') OR ('1'='1", "x\" OR \"1\"=\"1"],
				});

				expect(run.status).toBe(200);
				expect(names(run)).toEqual([]);
			});

			it("takes a long list", async () => {
				const value = [...Array.from({ length: 5000 }, (_, i) => `nobody-${i}`), ADA];
				const run = await find(engine, "in", { column: "name", value });

				expect(names(run)).toEqual([ADA]);
			});
		});

		describe("is_null / is_not_null", () => {
			it("matches a null — and on Mongo a missing field too", async () => {
				const run = await find(engine, "is_null", { column: "nickname" });

				expect(names(run)).toEqual(sorted([GRACE, GHOST]));
			});

			it("matches the rest with is_not_null", async () => {
				const run = await find(engine, "is_not_null", { column: "nickname" });

				expect(names(run)).toEqual(sorted([ADA, PCT, PLUS]));
			});

			it("ignores whatever value the body sends", async () => {
				const run = await find(engine, "is_null", { column: "nickname", value: "ada" });

				expect(names(run)).toEqual(sorted([GRACE, GHOST]));
			});

			it("reads eq null as is_null, not the never-matching = NULL", async () => {
				const run = await find(engine, "eq", { column: "nickname", value: null });

				expect(names(run)).toEqual(sorted([GRACE, GHOST]));
			});

			it("reads neq null as is_not_null", async () => {
				const run = await find(engine, "neq", { column: "nickname", value: null });

				expect(names(run)).toEqual(sorted([ADA, PCT, PLUS]));
			});

			it("checks a JSON path", async () => {
				const run = await find(engine, "is_null", { column: "profile.city" });

				expect(names(run)).toEqual([GHOST]);
			});
		});

		describe("contains / starts_with / ends_with", () => {
			it("ignores case", async () => {
				const run = await find(engine, "contains", { column: "name", value: "LOVE" });

				expect(names(run)).toEqual([ADA]);
			});

			it("treats % as a character, not a wildcard", async () => {
				const run = await find(engine, "contains", { column: "name", value: "%" });

				expect(names(run)).toEqual([PCT]);
			});

			it("treats _ as a character, not a wildcard", async () => {
				const run = await find(engine, "contains", { column: "name", value: "_" });

				expect(names(run)).toEqual([PCT]);
			});

			it("treats a backslash as a character, not an escape", async () => {
				const run = await find(engine, "ends_with", { column: "name", value: "\\" });

				expect(names(run)).toEqual([PCT]);
			});

			it("treats regex syntax as characters", async () => {
				const run = await find(engine, "contains", { column: "name", value: ".*" });

				expect(names(run)).toEqual([PLUS]);
			});

			it("anchors starts_with through regex-special text", async () => {
				const run = await find(engine, "starts_with", { column: "name", value: "c++ (DEV) [" });

				expect(names(run)).toEqual([PLUS]);
			});

			it("anchors ends_with", async () => {
				const run = await find(engine, "ends_with", { column: "name", value: "hopper" });

				expect(names(run)).toEqual([GRACE]);
			});

			it("does not match the middle for starts_with", async () => {
				const run = await find(engine, "starts_with", { column: "name", value: "lovelace" });

				expect(names(run)).toEqual([]);
			});

			it("ignores case inside a JSON path", async () => {
				const run = await find(engine, "contains", { column: "profile.city", value: "LOND" });

				expect(names(run)).toEqual(sorted([ADA, PLUS]));
			});

			it("refuses an object instead of matching its text", async () => {
				expectRefused(await find(engine, "contains", { column: "name", value: { $ne: null } }));
			});

			it("refuses null", async () => {
				expectRefused(await find(engine, "contains", { column: "name", value: null }));
			});
		});

		describe("between", () => {
			it("includes both ends", async () => {
				const run = await find(engine, "between", { column: "age", value: [18, 41] });

				expect(names(run)).toEqual(sorted([ADA, PCT, PLUS]));
			});

			it("takes the range as text and still compares numbers", async () => {
				// as strings, "100" < "41"; as numbers it is out of range
				const run = await find(engine, "between", { column: "age", value: "18, 41" });

				expect(names(run)).toEqual(sorted([ADA, PCT, PLUS]));
			});

			it("compares a JSON path as numbers", async () => {
				// as text "10" sorts before "7" and Ada would drop out
				const run = await find(engine, "between", { column: "profile.score", value: [7, 10] });

				expect(names(run)).toEqual(sorted([ADA, PCT, PLUS]));
			});

			it("matches nothing for a reversed range", async () => {
				const run = await find(engine, "between", { column: "age", value: [41, 18] });

				expect(run.status).toBe(200);
				expect(names(run)).toEqual([]);
			});

			it("refuses a single value", async () => {
				expectRefused(await find(engine, "between", { column: "age", value: [18] }));
			});

			it("refuses three values", async () => {
				expectRefused(await find(engine, "between", { column: "age", value: "1,2,3" }));
			});

			it("refuses a null end instead of leaving the range open", async () => {
				expectRefused(await find(engine, "between", { column: "age", value: [18, null] }));
			});
		});

		it("keeps an OR from leaking out of a null check", async () => {
			const run = await runGraph(
				withConditions(engine, [
					{ column: "age", operator: "in", value: { kind: "literal", value: [85, 36] } },
					{ column: "nickname", operator: "is_null", chain: "and" },
					{
						column: "name",
						operator: "starts_with",
						value: { kind: "literal", value: "100" },
						chain: "or",
					},
				]),
				{ body: {} },
			);

			// (age in [85, 36] AND nickname is null) OR name starts with "100"
			expect(names(run)).toEqual(sorted([GRACE, PCT]));
		});
	});
}

for (const engine of ["pg", "mysql"] as const) {
	describe(`SQL-only conditions on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("refuses exists, which only MongoDB has", async () => {
			expectRefused(await find(engine, "exists", { column: "nickname" }));
		});

		it("treats a column with SQL in it as a name", async () => {
			expectRefused(
				await find(engine, "in", { column: "name) OR (1=1", value: [ADA] }),
			);
		});

		it("refuses a column on the value side of in", async () => {
			const run = await runGraph(
				withConditions(engine, [
					{ column: "name", operator: "in", value: { kind: "column", value: "nickname" } },
				]),
				{ body: {} },
			);

			expectRefused(run);
		});

		it("matches ids sent as comma-separated text", async () => {
			const run = await find(engine, "in", { column: "id", value: "1, 2" });

			expect(names(run)).toEqual(sorted([ADA, GRACE]));
		});

		it("searches a number column as text", async () => {
			const run = await find(engine, "contains", { column: "age", value: "8" });

			expect(names(run)).toEqual(sorted([GRACE, PLUS]));
		});
	});
}

describe("MongoDB-only conditions", () => {
	beforeEach(() => resetDatabase("mongo"));

	it("tells an explicit null from a missing field with exists", async () => {
		const run = await find("mongo", "exists", { column: "nickname" });

		expect(names(run)).toEqual(sorted([ADA, GRACE, PCT, PLUS]));
	});

	it("finds the missing field with not_exists", async () => {
		const run = await find("mongo", "not_exists", { column: "nickname" });

		expect(names(run)).toEqual([GHOST]);
	});

	it("matches in as typed: text does not match a number", async () => {
		const run = await find("mongo", "in", { column: "age", value: "36" });

		expect(names(run)).toEqual([]);
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #504: condition groups — brackets in a WHERE. Conditions combine strictly
 * left to right, so most cases here are built so the grouped answer and the
 * flat left-to-right answer differ: a group that leaks its brackets fails
 * loudly instead of passing by luck. Each case asserts one result for all
 * three databases.
 *
 * Seed (`PEOPLE`):
 *   Ada Lovelace      nickname ada   age 36
 *   Grace Hopper      nickname null  age 85
 *   100% Real_Name\   nickname pct   age 41
 *   C++ (dev) [x].*   nickname plus  age 18
 *   Ghost             everything but the name null (on Mongo, missing)
 */
const people = await loadGraph("conditions/people");
const peopleDelete = await loadGraph("conditions/people-delete");

const ADA = "Ada Lovelace";
const GRACE = "Grace Hopper";
const PCT = "100% Real_Name\\";
const PLUS = "C++ (dev) [x].*";
const GHOST = "Ghost";
const EVERYONE = [ADA, GRACE, PCT, PLUS, GHOST];

type Chain = "and" | "or";
type Cond = Record<string, unknown>;

/** a value read from the request body at run time; undefined when not sent */
const fromBody = (key: string) => `js:return getRequestBody().${key};`;

function where(column: string, operator: string, value?: unknown, chain: Chain = "and"): Cond {
	return {
		attribute: { kind: "column", value: column },
		operator,
		...(value === undefined ? {} : { value: { kind: "literal", value } }),
		chain,
	};
}
const or = (condition: Cond): Cond => ({ ...condition, chain: "or" });
const group = (items: Cond[], chain: Chain = "and"): Cond => ({ group: items, chain });

/** the fixture with one block's conditions replaced */
function withConditions(
	graph: GraphFixture,
	engine: Engine,
	blockId: string,
	conditions: Cond[],
): GraphFixture {
	return {
		...graph,
		engine,
		blocks: graph.blocks.map((b) =>
			b.id === blockId ? { ...b, data: { ...(b.data as object), conditions } } : b,
		) as GraphFixture["blocks"],
	};
}

const find = (engine: Engine, conditions: Cond[], body: Record<string, unknown> = {}) =>
	runGraph(withConditions(people, engine, "find", conditions), { body });

/** the names a run returned, sorted so the database's row order does not matter */
const names = (run: { body: unknown }) =>
	(run.body as { name: string }[]).map((row) => row.name).sort();

const sorted = (list: string[]) => [...list].sort();

async function expectNames(
	engine: Engine,
	conditions: Cond[],
	expected: string[],
	body: Record<string, unknown> = {},
) {
	const run = await find(engine, conditions, body);
	expect(run.status).toBe(200);
	expect(names(run)).toEqual(sorted(expected));
}

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`condition groups on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		describe("brackets change the answer", () => {
			it("a OR (b AND c): the group binds tighter than the chain before it", async () => {
				// flat, left to right: (Ada OR age > 40) AND pct -> PCT only
				await expectNames(
					engine,
					[where("name", "eq", ADA), group([where("age", "gt", 40), where("nickname", "eq", "pct")], "or")],
					[ADA, PCT],
				);
			});

			it("a AND (b OR c): the chain after a group cannot reach inside it", async () => {
				// flat, left to right: (age < 50 AND Ada) OR Grace -> Ada and Grace
				await expectNames(
					engine,
					[where("age", "lt", 50), group([where("name", "eq", ADA), or(where("name", "eq", GRACE))])],
					[ADA],
				);
			});

			it("(a OR b) AND c: a group first, then more conditions", async () => {
				await expectNames(
					engine,
					[
						group([where("nickname", "eq", "ada"), or(where("nickname", "eq", "plus"))]),
						where("age", "gt", 20),
					],
					[ADA],
				);
			});

			it("two groups side by side: (a OR b) AND (c OR d)", async () => {
				await expectNames(
					engine,
					[
						group([where("age", "lt", 20), or(where("age", "gt", 80))]),
						group([where("nickname", "eq", "plus"), or(where("nickname", "is_null"))]),
					],
					[GRACE, PLUS],
				);
			});

			it("ignores the chain on a group's first condition, like the list's first", async () => {
				// an "or" leading the group must not become "age > 80 OR ..." at the top
				await expectNames(
					engine,
					[where("age", "gt", 80), group([or(where("name", "eq", ADA)), or(where("name", "eq", GRACE))])],
					[GRACE],
				);
			});

			it("ignores the chain on a group that leads the list", async () => {
				await expectNames(engine, [group([where("name", "eq", ADA)], "or"), where("age", "gt", 80)], []);
			});
		});

		describe("deep nesting", () => {
			it("keeps four levels of brackets: a AND (b OR (c AND (d OR e)))", async () => {
				await expectNames(
					engine,
					[
						where("age", "gte", 18),
						group([
							where("nickname", "eq", "plus"),
							group(
								[
									where("age", "gt", 40),
									group([where("nickname", "is_null"), or(where("name", "eq", ADA))]),
								],
								"or",
							),
						]),
					],
					[GRACE, PLUS],
				);
			});

			it("a single condition wrapped in many groups is just that condition", async () => {
				let tree: Cond = where("name", "eq", PCT);
				for (let depth = 0; depth < 12; depth++) tree = group([tree]);
				await expectNames(engine, [tree], [PCT]);
			});

			it("uses the new operators inside groups", async () => {
				await expectNames(
					engine,
					[
						group([where("name", "in", [ADA, GRACE]), where("nickname", "is_not_null")]),
						or(group([where("name", "contains", "%"), or(where("age", "between", [80, 90]))])),
					],
					[ADA, GRACE, PCT],
				);
			});
		});

		describe("skipped values", () => {
			it("drops a group whose conditions are all skipped, instead of OR-ing in everything", async () => {
				await expectNames(
					engine,
					[
						where("age", "gt", 100),
						group([where("nickname", "eq", fromBody("nick")), where("age", "eq", fromBody("age"))], "or"),
					],
					[],
				);
			});

			it("drops an all-skipped group nested inside a kept one", async () => {
				await expectNames(
					engine,
					[
						where("name", "eq", ADA),
						group(
							[where("nickname", "eq", "pct"), or(group([where("age", "eq", fromBody("missing"))]))],
							"or",
						),
					],
					[ADA, PCT],
				);
			});

			it("keeps what is left of a partly skipped group, still bracketed", async () => {
				// the group shrinks to (name = Ada AND age > 30); skipping must not
				// unhook "age > 30" and apply it to the whole query
				await expectNames(
					engine,
					[
						where("age", "lt", 20),
						group(
							[where("nickname", "eq", fromBody("nick")), where("name", "eq", ADA), where("age", "gt", 30)],
							"or",
						),
					],
					[ADA, PLUS],
				);
			});

			it("fills a group from the body when the values are sent", async () => {
				await expectNames(
					engine,
					[
						where("age", "lt", 20),
						group([where("nickname", "eq", fromBody("nick")), where("age", "gt", fromBody("age"))], "or"),
					],
					[PCT, PLUS],
					{ nick: "pct", age: 40 },
				);
			});

			it("returns every row when every group is skipped or empty", async () => {
				await expectNames(
					engine,
					[group([]), group([where("name", "eq", fromBody("missing"))], "or"), group([group([])])],
					EVERYONE,
				);
			});

			it("an empty group next to a condition is ignored", async () => {
				await expectNames(engine, [where("name", "eq", ADA), group([], "or")], [ADA]);
			});
		});

		describe("hostile values inside groups", () => {
			it("binds a value deep in a group as data, never as query text", async () => {
				await expectNames(
					engine,
					[group([group([where("nickname", "eq", fromBody("nick")), or(where("name", "eq", fromBody("nick")))])])],
					[],
					{ nick: "x' OR '1'='1" },
				);
			});

			it("keeps a custom condition's own OR inside its group", async () => {
				const custom =
					engine === "mongo"
						? {
								operator: "raw",
								raw: "js:return { $or: [{ age: { $gt: getRequestBody().age } }, { nickname: 'nobody' }] }",
								chain: "and",
							}
						: {
								operator: "raw",
								raw: "age > {{ getRequestBody().age }} OR nickname = 'nobody'",
								chain: "and",
							};
				// leaked: Ada OR age > 40 OR nickname = 'nobody' AND pct -> Grace too
				await expectNames(
					engine,
					[where("name", "eq", ADA), group([custom, where("nickname", "eq", "pct")], "or")],
					[ADA, PCT],
					{ age: 40 },
				);
			});

			it("fails the block when a condition deep in a group is invalid", async () => {
				const run = await find(engine, [
					where("name", "eq", ADA),
					group([group([where("name", "between", [1, 2, 3])])], "or"),
				]);
				expect(run.status).toBeGreaterThanOrEqual(400);
				expect(run.executed).not.toContain("reply");
			});
		});

		describe("on a write path", () => {
			it("deletes only the rows the grouped WHERE matches", async () => {
				// flat, left to right: (Ghost OR age < 20) AND plus -> PLUS only
				const run = await runGraph(
					withConditions(peopleDelete, engine, "remove", [
						where("name", "eq", GHOST),
						group([where("age", "lt", 20), where("nickname", "eq", "plus")], "or"),
					]),
					{ body: {} },
				);
				expect(run.status).toBe(200);
				expect(names(run)).toEqual(sorted([ADA, GRACE, PCT]));
			});

			it("a delete whose groups are all skipped deletes every row (documented)", async () => {
				const run = await runGraph(
					withConditions(peopleDelete, engine, "remove", [
						group([where("name", "eq", fromBody("missing"))]),
					]),
					{ body: {} },
				);
				expect(run.status).toBe(200);
				expect(names(run)).toEqual([]);
			});
		});
	});
}

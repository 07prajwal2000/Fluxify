import { describe, expect, it } from "bun:test";
import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";
import { activeSorts, applySqlSort, type DbSort, singleRow, withTiebreaker } from "./sort";

const db = new Kysely<any>({
	dialect: {
		createAdapter: () => new PostgresAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (d) => new PostgresIntrospector(d),
		createQueryCompiler: () => new PostgresQueryCompiler(),
	},
});

const by = (attribute: unknown, direction: "asc" | "desc" = "asc") =>
	({ attribute, direction }) as DbSort;

describe("activeSorts", () => {
	it("skips an entry whose column was not sent, keeping the order of the rest", () => {
		expect(activeSorts([by("a"), by(undefined), by(null), by("b", "desc")])).toEqual([
			by("a"),
			by("b", "desc"),
		]);
	});

	it("refuses a blank column, naming which entry", () => {
		expect(() => activeSorts([by("a"), by("  ")])).toThrow("sort 2 has no column");
		expect(() => activeSorts([by(7)])).toThrow("sort 1 has no column");
	});
});

describe("withTiebreaker", () => {
	it("adds the key last, ascending", () => {
		expect(withTiebreaker([by("created", "desc")], ["id"], "users")).toEqual([
			by("created", "desc"),
			by("id"),
		]);
	});

	it("leaves the key where the user put it, in whatever direction", () => {
		const sorts = [by("id", "desc"), by("name")];
		expect(withTiebreaker(sorts, ["id"], "users")).toEqual(sorts);
		expect(withTiebreaker([by("users.id", "desc")], ["id"], "users", true)).toEqual([
			by("users.id", "desc"),
		]);
	});

	it("adds only the missing parts of a composite key, qualified when joined", () => {
		expect(withTiebreaker([by("b")], ["a", "b"], "t", true)).toEqual([by("b"), by("t.a")]);
	});

	it("an empty sort becomes key order; no key adds nothing", () => {
		expect(withTiebreaker([], ["id"], "users")).toEqual([by("id")]);
		expect(withTiebreaker([by("x")], [], "view")).toEqual([by("x")]);
	});
});

describe("applySqlSort", () => {
	it("orders by every entry, first entry first", () => {
		const { sql } = applySqlSort(
			db.selectFrom("users").selectAll(),
			[by("created", "desc"), by("name"), by("id")],
			"postgres",
		).compile();
		expect(sql).toBe(`select * from "users" order by "created" desc, "name" asc, "id" asc`);
	});

	it("refuses a column that is not an identifier or path", () => {
		expect(() =>
			applySqlSort(db.selectFrom("users").selectAll(), [by("id; drop table users")], "postgres"),
		).toThrow();
	});
});

describe("singleRow", () => {
	it("returns the first row, or null for none", () => {
		expect(singleRow([{ id: 1 }])).toEqual({ id: 1 });
		expect(singleRow([], true)).toBeNull();
		expect(singleRow([{ id: 1 }, { id: 2 }])).toEqual({ id: 1 });
	});

	it("strict refuses a second match instead of picking one", () => {
		expect(singleRow([{ id: 1 }], true)).toEqual({ id: 1 });
		expect(() => singleRow([{ id: 1 }, { id: 2 }], true)).toThrow("expected 1 row, got more");
	});
});

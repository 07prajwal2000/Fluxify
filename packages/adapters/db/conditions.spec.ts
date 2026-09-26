import { describe, expect, it } from "bun:test";
import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";
import type { DBConditionType } from ".";
import {
	activeConditions,
	applySqlConditions,
	foldConditions,
	rawMongoFilter,
} from "./conditions";

// compiles without a database — only the generated SQL is under test
const db = new Kysely<any>({
	dialect: {
		createAdapter: () => new PostgresAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (d) => new PostgresIntrospector(d),
		createQueryCompiler: () => new PostgresQueryCompiler(),
	},
});

const compile = (conditions: DBConditionType[]) =>
	applySqlConditions(db.selectFrom("users").selectAll(), conditions, "postgres").compile();

const column = (value: string) => ({ kind: "column" as const, value });
const literal = (value: unknown) => ({ kind: "literal", value }) as any;
const rawSql = (strings: string[], values: unknown[], chain: "and" | "or" = "and") =>
	({ operator: "raw", raw: { strings, values }, chain }) as DBConditionType;

describe("applySqlConditions", () => {
	it("binds every {{ }} value of a custom condition as a parameter", () => {
		const { sql, parameters } = compile([
			rawSql(["name ILIKE ", " OR nick ILIKE ", ""], ["%ada%", "%ada%"]),
		]);

		// parenthesised, so the OR inside cannot escape into the chain
		expect(sql).toBe(`select * from "users" where (name ILIKE $1 OR nick ILIKE $2)`);
		expect(parameters).toEqual(["%ada%", "%ada%"]);
	});

	it("chains custom and structured conditions left to right", () => {
		const { sql, parameters } = compile([
			{ attribute: column("status"), operator: "eq", value: literal("active"), chain: "and" },
			rawSql(["age > ", ""], [18], "or"),
		]);

		expect(sql).toContain(`"status" = $1 or (age > $2)`);
		expect(parameters).toEqual(["active", 18]);
	});

	it("skips a condition holding undefined but keeps null", () => {
		const { sql, parameters } = compile([
			{ attribute: column("status"), operator: "eq", value: literal(undefined), chain: "and" },
			{ attribute: column("deleted_at"), operator: "eq", value: literal(null), chain: "and" },
			rawSql(["name ILIKE ", ""], [undefined], "or"),
		]);

		// eq null is IS NULL: "= NULL" never matches anything
		expect(sql).toBe(`select * from "users" where "deleted_at" is null`);
		expect(parameters).toEqual([]);
	});

	it("emits no WHERE at all when every condition is skipped", () => {
		const { sql } = compile([rawSql(["age > ", ""], [undefined])]);
		expect(sql).toBe(`select * from "users"`);
	});

	it("rejects a MongoDB-style filter on a SQL connection", () => {
		expect(() =>
			compile([{ operator: "raw", raw: { age: 1 }, chain: "and" }]),
		).toThrow("must be SQL text");
	});
});

const eq = (name: string, value: unknown, chain: "and" | "or" = "and") =>
	({ attribute: column(name), operator: "eq", value: literal(value), chain }) as DBConditionType;
const group = (items: DBConditionType[], chain: "and" | "or" = "and") =>
	({ group: items, chain }) as DBConditionType;

describe("condition groups", () => {
	it("brackets a group joined after a condition: a AND (b OR c)", () => {
		const { sql, parameters } = compile([
			eq("a", 1),
			group([eq("b", 2), eq("c", 3, "or")]),
		]);
		expect(sql).toBe(`select * from "users" where ("a" = $1 and ("b" = $2 or "c" = $3))`);
		expect(parameters).toEqual([1, 2, 3]);
	});

	it("brackets a group that comes first: (a OR b) AND c", () => {
		const { sql } = compile([group([eq("a", 1), eq("b", 2, "or")]), eq("c", 3)]);
		expect(sql).toBe(`select * from "users" where (("a" = $1 or "b" = $2) and "c" = $3)`);
	});

	it("ignores the chain of a group's first condition, like the list's first", () => {
		const { sql } = compile([eq("a", 1), group([eq("b", 2, "or"), eq("c", 3)], "or")]);
		expect(sql).toBe(`select * from "users" where ("a" = $1 or ("b" = $2 and "c" = $3))`);
	});

	it("nests groups at any depth and keeps parameter order", () => {
		const { sql, parameters } = compile([
			eq("a", 1),
			group([eq("b", 2), group([eq("c", 3), group([eq("d", 4), eq("e", 5, "or")])], "or")]),
		]);
		expect(sql).toBe(
			`select * from "users" where ("a" = $1 and ("b" = $2 or ("c" = $3 and ("d" = $4 or "e" = $5))))`,
		);
		expect(parameters).toEqual([1, 2, 3, 4, 5]);
	});

	it("drops a group whose conditions were all skipped", () => {
		const { sql } = compile([
			eq("a", 1),
			group([eq("b", undefined), group([eq("c", undefined, "or")])], "or"),
			eq("d", 4),
		]);
		expect(sql).toBe(`select * from "users" where ("a" = $1 and "d" = $2)`);
	});

	it("unwraps a group left with one condition", () => {
		const { sql } = compile([eq("a", 1), group([eq("b", undefined), eq("c", 3, "or")], "or")]);
		expect(sql).toBe(`select * from "users" where ("a" = $1 or "c" = $2)`);
	});

	it("emits no WHERE when the only thing left is an empty group", () => {
		expect(compile([group([])]).sql).toBe(`select * from "users"`);
		expect(compile([group([group([eq("a", undefined)])])]).sql).toBe(`select * from "users"`);
	});

	it("keeps a custom condition's OR inside its group", () => {
		const { sql, parameters } = compile([
			eq("a", 1),
			group([rawSql(["b = ", " OR c = ", ""], [2, 3]), eq("d", null)], "or"),
		]);
		expect(sql).toBe(
			`select * from "users" where ("a" = $1 or ((b = $2 OR c = $3) and "d" is null))`,
		);
		expect(parameters).toEqual([1, 2, 3]);
	});

	it("folds left to right inside a group, the same as at the top", () => {
		const text = foldConditions(
			activeConditions([eq("a", 1), group([eq("b", 2), eq("c", 3, "or"), eq("d", 4)], "or")]),
			(c) => String((c as any).attribute.value),
			(chain, left, right) => `(${left} ${chain} ${right})`,
		);
		expect(text).toBe("(a or ((b or c) and d))");
	});
});

describe("custom MongoDB conditions", () => {
	it("skips a filter that returned undefined", () => {
		expect(activeConditions([{ operator: "raw", raw: undefined, chain: "and" }])).toEqual([]);
	});

	it("accepts only a filter object", () => {
		expect(rawMongoFilter({ age: { $gte: 18 } })).toEqual({ age: { $gte: 18 } });
		expect(() => rawMongoFilter(null)).toThrow("filter object");
		expect(() => rawMongoFilter([])).toThrow("filter object");
		expect(() => rawMongoFilter({ strings: ["a"], values: [] })).toThrow("filter object");
	});
});

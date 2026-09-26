import { describe, expect, it } from "bun:test";
import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";
import type { DBConditionType } from ".";
import { activeConditions, applySqlConditions, rawMongoFilter } from "./conditions";

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

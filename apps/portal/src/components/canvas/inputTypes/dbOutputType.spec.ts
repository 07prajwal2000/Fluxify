import { describe, expect, it } from "bun:test";
import { allOutputType, columnType, type DbMeta, dbRowType, singleOutputType } from "./dbOutputType";

const pg: DbMeta = {
	variant: "PostgreSQL",
	tables: [
		{
			table: "users",
			columns: [
				{ name: "id", type: "integer" },
				{ name: "name", type: "text" },
				{ name: "created_at", type: "timestamp with time zone" },
			],
		},
		{
			table: "books",
			columns: [
				{ name: "id", type: "integer" },
				{ name: "title", type: "character varying" },
				{ name: "owner_id", type: "integer" },
			],
		},
	],
};

describe("columnType", () => {
	// each of these was read off the real driver, not assumed
	it("types Postgres columns as the driver returns them", () => {
		expect(columnType("PostgreSQL", "integer")).toBe("number");
		expect(columnType("PostgreSQL", "bigint")).toBe("string");
		expect(columnType("PostgreSQL", "numeric")).toBe("string");
		expect(columnType("PostgreSQL", "boolean")).toBe("boolean");
		expect(columnType("PostgreSQL", "timestamp without time zone")).toBe("Date");
		expect(columnType("PostgreSQL", "date")).toBe("Date");
		expect(columnType("PostgreSQL", "time without time zone")).toBe("string");
		expect(columnType("PostgreSQL", "jsonb")).toBe("any");
		expect(columnType("PostgreSQL", "ARRAY")).toBe("any[]");
		expect(columnType("PostgreSQL", "bytea")).toBe("Uint8Array");
		expect(columnType("PostgreSQL", "some_enum")).toBe("any");
	});

	it("types MySQL columns as the driver returns them", () => {
		expect(columnType("MySQL", "int unsigned")).toBe("number");
		expect(columnType("MySQL", "tinyint(1)")).toBe("number");
		expect(columnType("MySQL", "bigint")).toBe("number | string");
		expect(columnType("MySQL", "decimal(10,2)")).toBe("string");
		expect(columnType("MySQL", "varchar(255)")).toBe("string");
		expect(columnType("MySQL", "datetime")).toBe("Date");
		expect(columnType("MySQL", "json")).toBe("any");
		expect(columnType("MySQL", "blob")).toBe("Uint8Array");
		expect(columnType("MySQL", "enum('a','b')")).toBe('"a" | "b"');
	});

	it("types a Mongo field from the kinds seen in its documents", () => {
		expect(columnType("MongoDB", "number | string")).toBe("number | string");
		expect(columnType("MongoDB", "objectId")).toBe("string");
		expect(columnType("MongoDB", "date | null")).toBe("Date | null");
		expect(columnType("MongoDB", "array")).toBe("any[]");
	});
});

describe("dbRowType", () => {
	it("is every column of the table by default", () => {
		expect(dbRowType(pg, { tableName: "users" })).toBe(
			"{ id: number; name: string; created_at: Date; }",
		);
	});

	it("is only the picked columns", () => {
		expect(dbRowType(pg, { tableName: "users", columns: ["name", "id"] })).toBe(
			"{ name: string; id: number; }",
		);
	});

	it("renames a column with AS", () => {
		expect(dbRowType(pg, { tableName: "users", columns: ["users.name AS fullName"] })).toBe(
			"{ fullName: string; }",
		);
	});

	it("leaves an unknown expression open instead of guessing", () => {
		expect(dbRowType(pg, { tableName: "users", columns: ["id", "count(*) AS n"] })).toBe(
			"{ id: number; n: any; }",
		);
		expect(dbRowType(pg, { tableName: "users", columns: ["id", "lower(name)"] })).toBe(
			"{ id: number; [key: string]: any; }",
		);
	});

	it("reads a table given as a js literal, not as an expression", () => {
		expect(dbRowType(pg, { tableName: "js:'users'", columns: ["id"] })).toBe("{ id: number; }");
		expect(dbRowType(pg, { tableName: 'js:getQueryParam("t")' })).toBe("{ [key: string]: any }");
	});

	it("is an open row when the table or connection is unknown", () => {
		expect(dbRowType(null, { tableName: "users" })).toBe("{ [key: string]: any }");
		expect(dbRowType(pg, { tableName: "nope" })).toBe("{ [key: string]: any }");
		expect(dbRowType(pg, { tableName: "" })).toBe("{ [key: string]: any }");
	});

	it("takes qualified columns from the joined table, and nulls the optional side", () => {
		const joins = [{ type: "left", table: "books", alias: "b", on: [] }];

		expect(
			dbRowType(pg, { tableName: "users", columns: ["users.name", "b.title AS bookTitle"], joins }),
		).toBe("{ name: string; bookTitle: string | null; }");
		expect(dbRowType(pg, { tableName: "users", columns: ["b.*"], joins })).toBe(
			"{ id: number | null; title: string | null; owner_id: number | null; }",
		);
	});

	it("marks every Mongo field optional", () => {
		const mongo: DbMeta = {
			variant: "MongoDB",
			tables: [
				{
					table: "logs",
					columns: [
						{ name: "id", type: "objectId" },
						{ name: "n", type: "number" },
					],
				},
			],
		};

		expect(dbRowType(mongo, { tableName: "logs" })).toBe("{ id?: string; n?: number; }");
	});
});

describe("output wrappers", () => {
	it("hands on the row or null for a single lookup", () => {
		expect(singleOutputType("{ id: number; }")).toBe("{ id: number; } | null");
	});

	it("hands on a list, or a page with cursor paging", () => {
		expect(allOutputType("{ id: number; }", "offset")).toBe("({ id: number; })[]");
		expect(allOutputType("{ id: number; }", "cursor")).toBe(
			"{ rows: ({ id: number; })[]; nextCursor: string | null }",
		);
	});
});

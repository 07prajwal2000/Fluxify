import { describe, expect, it } from "bun:test";
import { mysqlPlaceholders } from "./placeholders";

describe("mysqlPlaceholders", () => {
	it("turns $n into ? and reorders params, repeating a reused one", () => {
		expect(mysqlPlaceholders("SELECT * FROM t WHERE a = $2 AND b = $1 OR c = $1", [1, 2])).toEqual({
			sql: "SELECT * FROM t WHERE a = ? AND b = ? OR c = ?",
			params: [2, 1, 1],
		});
	});

	it("leaves $ in strings, quoted names, comments and identifiers alone", () => {
		const sql =
			"SELECT '$1', \"it\\'s $2\", `$3`, JSON_EXTRACT(j, '$.a'), a$1 FROM t -- $4\n# $5\nWHERE /* $6 */ x = $1";
		expect(mysqlPlaceholders(sql, ["v"])).toEqual({
			sql: sql.replace(/x = \$1$/, "x = ?"),
			params: ["v"],
		});
	});

	it("passes plain ? queries through untouched", () => {
		expect(mysqlPlaceholders("SELECT ? AS a", [1])).toEqual({ sql: "SELECT ? AS a", params: [1] });
	});

	it("refuses a $n without a value, and mixing $n with ?", () => {
		expect(() => mysqlPlaceholders("SELECT $2", [1])).toThrow("$2 has no value: params has 1");
		expect(() => mysqlPlaceholders("SELECT $0", [1])).toThrow("$0 has no value");
		expect(() => mysqlPlaceholders("SELECT $1, ?", [1, 2])).toThrow("not both");
	});
});

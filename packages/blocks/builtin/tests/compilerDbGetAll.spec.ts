import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { block, createDbAdapter, runAround } from "./dbHarness";

describe("compiled db get all: limit, offset and cursor paging", () => {
	it("evaluates js table names, limit and offset for get all", async () => {
		const mock = createDbAdapter({ getAll: [{ id: 1 }] });
		const target = block("db", BlockTypes.db_getall, {
			connection: "conn-1",
			tableName: "js:return 'tenant_' + input.tenant",
			conditions: [],
			limit: "js:return input.limit",
			offset: "js:return input.offset",
			sort: { attribute: "id", direction: "desc" },
		});

		const { result } = await runAround(target, { tenant: "acme", limit: 25, offset: "40" }, mock);

		const [table, conditions, limit, offset, sort] = mock.calls[0].args;
		expect(table).toBe("tenant_acme");
		expect(conditions).toEqual([]);
		expect(limit).toBe(25);
		expect(offset).toBe(40); // a query param arrives as text
		// saved before sort was a list: the single object still loads, as a list of one
		expect(sort).toEqual([{ attribute: "id", direction: "desc" }]);
		expect(result.output.body).toEqual([{ id: 1 }]);
	});

	it("takes a limit over 1000 as is, and -1, null or an unset one as no cap / the default", async () => {
		const cases: [unknown, number | null][] = [
			[5000, 5000],
			[-1, null],
			["-1", null],
			[null, null],
			["", 1000],
			["js:return undefined", 1000],
		];
		for (const [given, expected] of cases) {
			const mock = createDbAdapter({ getAll: [] });
			const target = block("db", BlockTypes.db_getall, {
				connection: "conn-1",
				tableName: "users",
				conditions: [],
				limit: given,
				offset: 0,
			});
			await runAround(target, {}, mock);
			expect([given, mock.calls[0].args[2]]).toEqual([given, expected]);
		}
	});

	it("fails on a bad limit or offset before the query runs", async () => {
		const cases: [string, unknown, unknown, string][] = [
			["limit", "abc", 0, 'limit must be a whole number ≥ 1, or -1 for no limit, got "abc"'],
			["limit", 0, 0, "limit must be a whole number ≥ 1, or -1 for no limit, got 0"],
			["limit", "2.5", 0, 'limit must be a whole number ≥ 1, or -1 for no limit, got "2.5"'],
			["offset", 10, -3, "offset must be a whole number ≥ 0, got -3"],
			["offset", 10, "abc", 'offset must be a whole number ≥ 0, got "abc"'],
		];
		for (const [, limit, offset, message] of cases) {
			const mock = createDbAdapter({ getAll: [] });
			const target = block("db", BlockTypes.db_getall, {
				connection: "conn-1",
				tableName: "users",
				conditions: [],
				limit: "js:return input.limit",
				offset: "js:return input.offset",
			});
			const { result } = await runAround(target, { limit, offset }, mock);
			expect(result.error.message).toBe(message);
			expect(mock.calls).toEqual([]);
		}
	});

	it("cursor paging calls getPage with after and keys, and ignores offset", async () => {
		const page = { rows: [{ id: 1 }], nextCursor: "abc" };
		const mock = createDbAdapter({ getPage: page });
		const target = block("db", BlockTypes.db_getall, {
			connection: "conn-1",
			tableName: "users",
			conditions: [],
			limit: 20,
			offset: "not read in cursor mode",
			sort: [{ attribute: "created_at", direction: "desc" }],
			paging: "cursor",
			after: "js:return input.after",
			keys: ["email", "js:return input.key"],
		});

		const { result } = await runAround(target, { after: "xyz", key: "tenant" }, mock);

		expect(mock.calls[0].method).toBe("getPage");
		const [table, , limit, sort, cursor, options] = mock.calls[0].args;
		expect(table).toBe("users");
		expect(limit).toBe(20);
		expect(sort).toEqual([{ attribute: "created_at", direction: "desc" }]);
		expect(cursor).toEqual({ after: "xyz", keys: ["email", "tenant"] });
		expect(options).toEqual({ joins: [], columns: ["*"] });
		expect(result.output.body).toEqual(page);
	});

});

import { describe, expect, it } from "bun:test";
import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";
import { resolveCondition } from "./jsonPath";

// No container: a dummy driver compiles the query without running it, which is
// all these assertions need — the question is what SQL comes out, not what the
// database says about it.
const db = new Kysely<any>({
	dialect: {
		createAdapter: () => new PostgresAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (d) => new PostgresIntrospector(d),
		createQueryCompiler: () => new PostgresQueryCompiler(),
	},
});

function compileWhere(attribute: string, value: unknown) {
	const { lhs, rhs } = resolveCondition(attribute, value, "postgres");
	return db
		.selectFrom("users")
		.selectAll()
		.where(lhs as never, "=", rhs as never)
		.compile();
}

describe("resolveCondition", () => {
	it("keeps a dotted literal a bound value", () => {
		const { sql, parameters } = compileWhere("email", "ada@example.com");

		// the regression: this used to compile to `"ada@example" ->> 'com'`, so
		// Postgres rejected every lookup by email with `column does not exist`
		expect(sql).toContain(`"email" = $1`);
		expect(sql).not.toContain("->>");
		expect(parameters).toEqual(["ada@example.com"]);
	});

	it("treats a tagged column reference as an identifier", () => {
		const { sql, parameters } = compileWhere("email", {
			kind: "column",
			value: "backup_email",
		});

		expect(sql).toContain(`"email" = "backup_email"`);
		expect(parameters).toEqual([]);
	});

	it("builds a json path from a tagged column reference", () => {
		const { sql } = compileWhere("email", {
			kind: "column",
			value: "profile.contact",
		});

		expect(sql).toContain(`"profile" ->> 'contact'`);
	});

	it("still builds a json path from the attribute side", () => {
		const { sql, parameters } = compileWhere("profile.age", 30);

		expect(sql).toContain(`"profile" ->> 'age'`);
		expect(sql).toContain("::numeric");
		expect(parameters).toEqual([30]);
	});

	it("treats an untagged attribute as a column", () => {
		const { sql, parameters } = compileWhere("email", {
			kind: "literal",
			value: "ada@example.com",
		});

		expect(sql).toContain(`"email" = $1`);
		expect(parameters).toEqual(["ada@example.com"]);
	});

	it("binds a tagged literal attribute instead of naming a column", () => {
		const { lhs, rhs } = resolveCondition(
			{ kind: "literal", value: 18 },
			{ kind: "column", value: "age" },
			"postgres",
		);
		const { sql, parameters } = db
			.selectFrom("users")
			.selectAll()
			.where(lhs as never, "<=", rhs as never)
			.compile();

		// the literal is a bound parameter, the column an identifier — without the
		// tag the query builder would have read "18" as a column name
		expect(sql).toContain(`$1 <= "age"`);
		expect(parameters).toEqual([18]);
	});

	it("casts a json path compared against a tagged numeric literal", () => {
		const { lhs, rhs } = resolveCondition(
			{ kind: "literal", value: 30 },
			{ kind: "column", value: "profile.age" },
			"postgres",
		);
		const { sql } = db
			.selectFrom("users")
			.selectAll()
			.where(lhs as never, "<=", rhs as never)
			.compile();

		expect(sql).toContain("::numeric");
	});

	it("rejects a column reference that is not an identifier", () => {
		expect(() =>
			compileWhere("email", { kind: "column", value: "x; drop table users" }),
		).toThrow(/invalid column reference/);
	});
});

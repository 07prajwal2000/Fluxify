import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { adoptSql, type Snapshot } from "../adoptBaseline";
import { MIGRATIONS_FOLDER } from "../migration";

const snapshot: Snapshot = await Bun.file(join(MIGRATIONS_FOLDER, "meta/0000_snapshot.json")).json();
const { enums, schema } = adoptSql(snapshot);
const tables = Object.values(snapshot.tables);
const count = (pick: (t: (typeof tables)[number]) => object) =>
	tables.reduce((n, t) => n + Object.keys(pick(t)).length, 0);

describe("adoptSql", () => {
	test("covers every type, table, column, constraint and index in the baseline", () => {
		const values = Object.values(snapshot.enums).reduce((n, e) => n + e.values.length, 0);
		expect(enums).toHaveLength(Object.keys(snapshot.enums).length + values);
		expect(schema).toHaveLength(
			tables.length +
				count((t) => t.columns) +
				count((t) => t.compositePrimaryKeys) +
				count((t) => t.uniqueConstraints) +
				count((t) => t.checkConstraints) +
				count((t) => t.foreignKeys) +
				count((t) => t.indexes),
		);
	});

	test("every statement is safe to run on a database that already has it", () => {
		for (const stmt of [...enums, ...schema]) {
			expect(stmt).toMatch(/IF NOT EXISTS|EXCEPTION WHEN duplicate_object/);
		}
	});

	test("tables come before the foreign keys that point at them", () => {
		const lastTable = schema.findLastIndex((s) => s.startsWith("CREATE TABLE"));
		const firstFk = schema.findIndex((s) => s.includes("FOREIGN KEY"));
		expect(lastTable).toBeLessThan(firstFk);
	});
});

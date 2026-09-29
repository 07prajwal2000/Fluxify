import { describe, expect, it } from "bun:test";
import { assertJoinsSupported } from "../joinSupport";

const dbTypeOf = (connection: string) =>
	({ my: "mysql", pg: "pg", mongo: "mongo" })[connection];
const getAll = (connection: string, type: string) => ({
	id: `b-${connection}`,
	type: "db_getall",
	data: { blockName: "Orders", connection, joins: [{ table: "riders", type, on: [] }] },
});

describe("assertJoinsSupported", () => {
	it("refuses a full join on MySQL, old `outer` included", () => {
		for (const type of ["full", "outer"]) {
			expect(() => assertJoinsSupported([getAll("my", type)], dbTypeOf)).toThrow(
				'Block "Orders" (b-my): MySQL has no full join. Use a left or right join.',
			);
		}
	});

	it("saves every join type on PostgreSQL, and the other types on MySQL", () => {
		for (const type of ["inner", "left", "right", "full"]) {
			expect(() => assertJoinsSupported([getAll("pg", type)], dbTypeOf)).not.toThrow();
		}
		for (const type of ["inner", "left", "right"]) {
			expect(() => assertJoinsSupported([getAll("my", type)], dbTypeOf)).not.toThrow();
		}
	});

	it("refuses any join on MongoDB", () => {
		expect(() => assertJoinsSupported([getAll("mongo", "inner")], dbTypeOf)).toThrow(
			"MongoDB has no joins yet",
		);
	});

	it("leaves a js: connection to run time", () => {
		expect(() => assertJoinsSupported([getAll("js:return 'my'", "full")], dbTypeOf)).not.toThrow();
	});
});

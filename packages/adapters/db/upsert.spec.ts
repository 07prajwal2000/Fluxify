import { expect, test } from "bun:test";
import { conflictKeys, conflictUpdateColumns, mongoUpsertOps } from "./upsert";

test("update defaults to every inserted column except the target", () => {
	const rows = [{ email: "a", name: "A" }, { email: "b", age: 3 }];
	expect(conflictUpdateColumns(rows, { target: ["email"], action: "update" })).toEqual([
		"name",
		"age",
	]);
	expect(conflictUpdateColumns(rows, { target: ["email"], action: "update", update: ["name"] })).toEqual(["name"]);
});

test("a row without a target value is rejected", () => {
	expect(() => conflictKeys([{ name: "A" }], ["email"])).toThrow('no value for "email"');
});

test("mongo ops: $eq filters, no empty operator, id never written", () => {
	const { ops } = mongoUpsertOps([{ id: "x", email: { $ne: null }, name: "A" }], {
		target: ["email"],
		action: "ignore",
	});
	expect(ops[0].updateOne).toEqual({
		filter: { email: { $eq: { $ne: null } } },
		update: { $setOnInsert: { email: { $ne: null }, name: "A" } },
		upsert: true,
	});
});

import { expect, test } from "bun:test";
import { isCounterOp, mongoCounterUpdate, splitCounters } from "./counter";

test("only { op: inc | dec, value } is a counter", () => {
	expect(isCounterOp({ op: "inc", value: 1 })).toBe(true);
	expect(isCounterOp({ op: "inc", value: 1, extra: 1 })).toBe(false);
	expect(isCounterOp({ op: "set", value: 1 })).toBe(false);
	expect(isCounterOp([1, 2])).toBe(false);
});

test("mongo: counters under $inc, dec negated, no empty $set", () => {
	expect(mongoCounterUpdate({ hits: { op: "dec", value: 2 } })).toEqual({ $inc: { hits: -2 } });
});

test("upsert rows start at the amount; mixed or matched-on counters are rejected", () => {
	expect(splitCounters([{ name: "a", hits: { op: "inc", value: 3 } }], ["name"])).toEqual({
		rows: [{ name: "a", hits: 3 }],
		counters: ["hits"],
	});
	expect(() => splitCounters([{ hits: { op: "inc", value: 1 } }, { hits: 5 }], ["name"])).toThrow(
		"a counter in one row and a plain value",
	);
	expect(() => splitCounters([{ name: { op: "inc", value: 1 } }], ["name"])).toThrow("matched on");
	expect(() => splitCounters([{ hits: { op: "inc", value: "1" } }], ["name"])).toThrow("needs a number");
});

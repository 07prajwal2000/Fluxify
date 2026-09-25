import { describe, expect, it } from "bun:test";
import { MAX_CASES, runCases, toCases } from "../cases";

describe("toCases", () => {
	it("keeps { name, input } items and names the unnamed ones", () => {
		expect(toCases([{ name: "only status", input: { s: 1 } }, { input: 2 }])).toEqual([
			{ name: "only status", input: { s: 1 } },
			{ name: "Case 2", input: 2 },
		]);
	});

	it("wraps plain values as the input", () => {
		expect(toCases([1, { a: 1 }])).toEqual([
			{ name: "Case 1", input: 1 },
			{ name: "Case 2", input: { a: 1 } },
		]);
	});

	it("rejects a non-list and a list over the limit", () => {
		expect(() => toCases({ input: 1 })).toThrow("must be a list");
		expect(() => toCases(Array(MAX_CASES + 1).fill(1))).toThrow("Too many cases");
	});
});

describe("runCases", () => {
	it("runs every case in order, keeps going after a failure, and counts", async () => {
		const seen: number[] = [];
		const { cases, counts } = await runCases(toCases([1, 2, 3]), async (item) => {
			seen.push(item.input as number);
			return {
				status: item.input === 2 ? "failed" : "passed",
				checks: [],
				durationMs: 1,
			};
		});
		expect(seen).toEqual([1, 2, 3]);
		expect(cases.map((c) => [c.index, c.status])).toEqual([
			[0, "passed"],
			[1, "failed"],
			[2, "passed"],
		]);
		expect(counts).toEqual({ total: 3, passed: 2, failed: 1, error: 0, timeout: 0 });
	});
});

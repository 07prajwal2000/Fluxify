import { expect, test } from "bun:test";
import { CACHE_COLD_AFTER_MS, isCacheCold, lastModelCallAt } from "./cacheIdle";

const at = (iso: string) => Date.parse(iso);

test("the last model call is the newest dated row, in any order", () => {
	expect(
		lastModelCallAt([
			{ createdAt: "2026-10-22T10:05:00.000Z" },
			{ createdAt: "2026-10-22T10:20:00.000Z" },
			{ createdAt: "2026-10-22T10:10:00.000Z" },
		]),
	).toBe(at("2026-10-22T10:20:00.000Z"));
});

test("no rows, or none dated, has no last call", () => {
	expect(lastModelCallAt([])).toBeNull();
	expect(lastModelCallAt([{}, { createdAt: "not a date" }])).toBeNull();
	expect(lastModelCallAt([{}, { createdAt: "2026-10-22T10:00:00.000Z" }])).toBe(
		at("2026-10-22T10:00:00.000Z"),
	);
});

test("cold only after the threshold, never while running or undated", () => {
	const last = at("2026-10-22T10:00:00.000Z");
	expect(CACHE_COLD_AFTER_MS).toBe(20 * 60_000);
	expect(isCacheCold(last, last + CACHE_COLD_AFTER_MS - 1, false)).toBe(false);
	expect(isCacheCold(last, last + CACHE_COLD_AFTER_MS, false)).toBe(true);
	expect(isCacheCold(last, last + CACHE_COLD_AFTER_MS * 3, true)).toBe(false);
	expect(isCacheCold(null, last, false)).toBe(false);
	// server clock ahead of the browser: the last call looks like it is in the future
	expect(isCacheCold(last, last - 60_000, false)).toBe(false);
});

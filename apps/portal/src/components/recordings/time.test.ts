import { describe, expect, test } from "bun:test";
import { formatAbsoluteTime, formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
	const base = 1_700_000_000_000;

	test("returns dash for missing or invalid dates", () => {
		expect(formatRelativeTime(null)).toBe("—");
		expect(formatRelativeTime(undefined)).toBe("—");
		expect(formatRelativeTime("invalid-date")).toBe("—");
	});

	test("0s reads 'just now'", () => {
		expect(formatRelativeTime(base, base)).toBe("just now");
		expect(formatRelativeTime(base, base + 500)).toBe("just now");
		expect(formatRelativeTime(base, base - 500)).toBe("just now");
	});

	test("1s to 10s steps through each second", () => {
		expect(formatRelativeTime(base, base + 1_000)).toBe("1s ago");
		expect(formatRelativeTime(base, base + 2_000)).toBe("2s ago");
		expect(formatRelativeTime(base, base + 5_400)).toBe("5s ago");
		expect(formatRelativeTime(base, base + 9_999)).toBe("9s ago");
		expect(formatRelativeTime(base, base + 10_000)).toBe("10s ago");
		expect(formatRelativeTime(base, base + 10_999)).toBe("10s ago");
	});

	test("11s to 20s reads '20s ago'", () => {
		expect(formatRelativeTime(base, base + 11_000)).toBe("20s ago");
		expect(formatRelativeTime(base, base + 15_000)).toBe("20s ago");
		expect(formatRelativeTime(base, base + 20_000)).toBe("20s ago");
		expect(formatRelativeTime(base, base + 20_999)).toBe("20s ago");
	});

	test("21s to 59s reads '30s ago'", () => {
		expect(formatRelativeTime(base, base + 21_000)).toBe("30s ago");
		expect(formatRelativeTime(base, base + 30_000)).toBe("30s ago");
		expect(formatRelativeTime(base, base + 45_000)).toBe("30s ago");
		expect(formatRelativeTime(base, base + 59_000)).toBe("30s ago");
		expect(formatRelativeTime(base, base + 59_999)).toBe("30s ago");
	});

	test("1 min and above formats in minutes and hours", () => {
		expect(formatRelativeTime(base, base + 60_000)).toBe("1m ago");
		expect(formatRelativeTime(base, base + 89_000)).toBe("1m ago");
		expect(formatRelativeTime(base, base + 90_000)).toBe("2m ago");
		expect(formatRelativeTime(base, base + 120_000)).toBe("2m ago");
		expect(formatRelativeTime(base, base + 59 * 60_000)).toBe("59m ago");
		expect(formatRelativeTime(base, base + 60 * 60_000)).toBe("1h ago");
		expect(formatRelativeTime(base, base + 2 * 60 * 60_000)).toBe("2h ago");
	});

	test("over 24 hours formats using toLocaleString", () => {
		const target = new Date(base);
		const formatted = formatRelativeTime(base, base + 25 * 60 * 60_000);
		expect(formatted).toBe(target.toLocaleString());
	});
});

describe("formatAbsoluteTime", () => {
	test("returns empty string for missing or invalid dates", () => {
		expect(formatAbsoluteTime(null)).toBe("");
		expect(formatAbsoluteTime(undefined)).toBe("");
		expect(formatAbsoluteTime("invalid-date")).toBe("");
	});

	test("formats date in local timezone matching 'D Mon YYYY, HH:mm:ss'", () => {
		const d = new Date(2026, 9, 23, 14, 32, 8); // month 9 is October (0-indexed)
		expect(formatAbsoluteTime(d)).toBe("23 Oct 2026, 14:32:08");

		const dMorning = new Date(2026, 0, 5, 9, 4, 2); // 5 Jan 2026, 09:04:02
		expect(formatAbsoluteTime(dMorning)).toBe("5 Jan 2026, 09:04:02");
	});
});

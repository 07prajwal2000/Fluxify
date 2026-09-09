import { describe, expect, it } from "bun:test";
import {
	applyJitter,
	assertSchedule,
	describeSchedule,
	intervalMs,
	nextFires,
	parseDurationMs,
	parseSchedule,
	ScheduleError,
} from "../index";

const FROM = new Date("2026-03-01T00:00:00Z");

describe("parseSchedule", () => {
	it("reads the four forms", () => {
		expect(parseSchedule("@at 2026-01-01T09:00:00Z")).toEqual({
			kind: "at",
			at: new Date("2026-01-01T09:00:00Z"),
		});
		expect(parseSchedule("@every 90s")).toEqual({ kind: "every", ms: 90_000 });
		expect(parseSchedule("@daily")).toEqual({ kind: "cron", expression: "0 0 0 * * *" });
		expect(parseSchedule("0 30 9 * * 1-5")).toEqual({
			kind: "cron",
			expression: "0 30 9 * * 1-5",
		});
	});

	it("refuses five-field cron rather than running it 60x too often", () => {
		// The format every other tool uses. Accepting it silently would shift
		// every field by one position.
		expect(() => parseSchedule("30 9 * * 1-5")).toThrow(/six fields/);
	});

	it("refuses intervals the server would reject", () => {
		expect(() => parseSchedule("@every 500ms")).toThrow(/shortest interval/);
		expect(() => parseSchedule("@every soon")).toThrow(ScheduleError);
		expect(() => parseSchedule("@yesterday")).toThrow(/not a known shorthand/);
		expect(() => parseSchedule("@at never")).toThrow(/not a date/);
		expect(() => parseSchedule("")).toThrow(ScheduleError);
	});

	it("refuses a fixed offset, which would opt out of daylight saving", () => {
		expect(() => assertSchedule("@daily", "+05:30")).toThrow(/IANA/);
		expect(() => assertSchedule("@daily", "Mars/Olympus")).toThrow(/Unknown timezone/);
		expect(() => assertSchedule("@daily", "Asia/Kolkata")).not.toThrow();
	});
});

describe("parseDurationMs", () => {
	it("reads Go duration strings", () => {
		expect(parseDurationMs("1s")).toBe(1_000);
		expect(parseDurationMs("1h30m")).toBe(5_400_000);
		expect(parseDurationMs("1.5h")).toBe(5_400_000);
		expect(() => parseDurationMs("1 hour")).toThrow(ScheduleError);
	});
});

describe("nextFires", () => {
	it("walks a cron in its own timezone", () => {
		const fires = nextFires("0 30 9 * * *", "Asia/Kolkata", 2, FROM);
		// 09:30 in Kolkata is 04:00 UTC.
		expect(fires[0]?.toISOString()).toBe("2026-03-01T04:00:00.000Z");
		expect(fires[1]?.toISOString()).toBe("2026-03-02T04:00:00.000Z");
	});

	it("gives a one-shot exactly one fire, and a past one none", () => {
		expect(nextFires("@at 2026-04-01T00:00:00Z", "UTC", 5, FROM)).toHaveLength(1);
		expect(nextFires("@at 2020-01-01T00:00:00Z", "UTC", 5, FROM)).toHaveLength(0);
	});

	it("counts an interval from now", () => {
		const fires = nextFires("@every 1m", "UTC", 2, FROM);
		expect(fires[0]?.toISOString()).toBe("2026-03-01T00:01:00.000Z");
		expect(fires[1]?.toISOString()).toBe("2026-03-01T00:02:00.000Z");
	});
});

describe("intervalMs", () => {
	it("measures the gap between the next two fires", () => {
		expect(intervalMs("@every 30s", "UTC", FROM)).toBe(30_000);
		expect(intervalMs("0 0 * * * *", "UTC", FROM)).toBe(3_600_000);
	});

	it("has none for a one-shot, so it gets no TTL", () => {
		expect(intervalMs("@at 2026-04-01T00:00:00Z", "UTC", FROM)).toBeUndefined();
	});
});

describe("applyJitter", () => {
	it("is stable per id and spreads across ids", () => {
		const a = applyJitter("@daily", "trigger-a");
		expect(a).toBe(applyJitter("@daily", "trigger-a"));
		expect(a).not.toBe(applyJitter("@daily", "trigger-b"));
		expect(a).toMatch(/^\d+ 0 0 \* \* \*$/);
		expect(Number(a.split(" ")[0])).toBeLessThan(60);
	});

	it("leaves an explicitly chosen second alone", () => {
		expect(applyJitter("15 0 0 * * *", "trigger-a")).toBe("15 0 0 * * *");
	});

	it("leaves intervals and one-shots alone — they have no seconds field", () => {
		expect(applyJitter("@every 5m", "trigger-a")).toBe("@every 5m");
		expect(applyJitter("@at 2026-04-01T00:00:00Z", "x")).toBe("@at 2026-04-01T00:00:00Z");
	});
});

describe("describeSchedule", () => {
	it("says what the spec means", () => {
		expect(describeSchedule("@every 1h")).toBe("Every hour");
		expect(describeSchedule("@every 5m")).toBe("Every 5 minutes");
		expect(describeSchedule("0 30 9 * * *", "Asia/Kolkata")).toBe(
			"Every day at 09:30 (Asia/Kolkata time)",
		);
		expect(describeSchedule("0 0 9 * * 1-5")).toBe("Every weekday at 09:00 (UTC)");
		expect(describeSchedule("@at 2026-04-01T00:00:00Z")).toStartWith("Once, at 2026-04-01");
	});
});

import { Cron } from "croner";

/**
 * Reading a schedule specification: what it means, when it fires next, and
 * whether the server will accept it at all.
 *
 * The spec is stored and transmitted as the one string NATS puts on the
 * `Nats-Schedule` header, so there is no second representation to keep in sync.
 * Everything here parses that string.
 *
 * Four forms, all of them ADR-51's:
 * - `@at <RFC3339>`     — fire once, then the schedule is gone.
 * - `@every <duration>` — fixed interval, minimum one second.
 * - `@daily` and friends — named cron aliases.
 * - `0 0 5 * * *`       — six fields, **seconds first**.
 *
 * Five-field cron is refused on purpose. It is the format every other tool
 * uses, so a user pasting one in would get a schedule that runs 60x too often
 * and no error saying why.
 */

export const PREDEFINED = [
	"@yearly",
	"@annually",
	"@monthly",
	"@weekly",
	"@daily",
	"@midnight",
	"@hourly",
] as const;

export type Predefined = (typeof PREDEFINED)[number];

export type ParsedSchedule =
	| { kind: "at"; at: Date }
	| { kind: "every"; ms: number }
	| { kind: "cron"; expression: string };

/** Raised for anything the server would reject, with a message a user can act on. */
export class ScheduleError extends Error {}

const CRON_BY_PREDEFINED: Record<Predefined, string> = {
	"@yearly": "0 0 0 1 1 *",
	"@annually": "0 0 0 1 1 *",
	"@monthly": "0 0 0 1 * *",
	"@weekly": "0 0 0 * * 0",
	"@daily": "0 0 0 * * *",
	"@midnight": "0 0 0 * * *",
	"@hourly": "0 0 * * * *",
};

const DURATION_UNITS_MS: Record<string, number> = {
	ns: 1e-6,
	us: 1e-3,
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
};

/**
 * Go duration strings, which is what the server parses: `1s`, `90m`, `1h30m`.
 * Fractions are allowed (`1.5h`), and so are several parts in a row.
 */
export function parseDurationMs(input: string): number {
	const text = input.trim();
	const parts = text.match(/\d+(?:\.\d+)?(?:ns|us|ms|s|m|h)/g);
	if (!parts || parts.join("") !== text)
		throw new ScheduleError(
			`"${input}" is not a duration — write it like 30s, 5m or 1h30m`,
		);
	return parts.reduce((total, part) => {
		const [, value, unit] = part.match(/^(\d+(?:\.\d+)?)(\D+)$/)!;
		return total + Number(value) * DURATION_UNITS_MS[unit!]!;
	}, 0);
}

/** Splits a spec into its parts, or explains why it is not one. */
export function parseSchedule(spec: string): ParsedSchedule {
	const text = spec.trim();
	if (!text) throw new ScheduleError("A schedule is required");

	if (text.startsWith("@at ")) {
		const at = new Date(text.slice(4).trim());
		if (Number.isNaN(at.getTime()))
			throw new ScheduleError(
				`"${text.slice(4).trim()}" is not a date — write it like 2026-01-01T09:00:00Z`,
			);
		return { kind: "at", at };
	}

	if (text.startsWith("@every ")) {
		const ms = parseDurationMs(text.slice(7));
		if (ms < 1_000) throw new ScheduleError("The shortest interval is 1s");
		return { kind: "every", ms };
	}

	const predefined = CRON_BY_PREDEFINED[text.toLowerCase() as Predefined];
	if (predefined) return { kind: "cron", expression: predefined };

	if (text.startsWith("@"))
		throw new ScheduleError(
			`"${text}" is not a known shorthand — use @at, @every, or one of ${PREDEFINED.join(", ")}`,
		);

	const fields = text.split(/\s+/);
	if (fields.length !== 6)
		throw new ScheduleError(
			`A cron expression needs six fields — seconds, minutes, hours, day of month, month, day of week. Got ${fields.length}.`,
		);
	// Croner is the parser rather than a hand-rolled one, and it is also what
	// computes the preview, so a spec that previews is a spec that parsed.
	try {
		new Cron(text);
	} catch (error) {
		throw new ScheduleError(`Not a valid cron expression: ${String(error)}`);
	}
	return { kind: "cron", expression: text };
}

/**
 * IANA names only. A fixed offset like `+05:30` looks equivalent and is not:
 * it silently opts the schedule out of daylight saving, so a user who meant
 * "9am in Kolkata" gets 9am for half the year.
 */
export function assertTimezone(timezone: string) {
	if (/^[+-]\d/.test(timezone))
		throw new ScheduleError(
			`Use an IANA timezone name like Asia/Kolkata, not a fixed offset (${timezone})`,
		);
	try {
		new Intl.DateTimeFormat("en", { timeZone: timezone });
	} catch {
		throw new ScheduleError(`Unknown timezone "${timezone}"`);
	}
	return timezone;
}

/** Throws on anything the server would reject. Timezone applies to cron only. */
export function assertSchedule(spec: string, timezone = "UTC") {
	assertTimezone(timezone);
	return parseSchedule(spec);
}

/**
 * The next few times this fires, for the portal's preview.
 *
 * Returns fewer than asked for when the schedule runs out — a `@at` in the past
 * fires never, and one in the future fires exactly once.
 */
export function nextFires(
	spec: string,
	timezone = "UTC",
	count = 5,
	from: Date = new Date(),
): Date[] {
	const parsed = assertSchedule(spec, timezone);
	if (parsed.kind === "at") return parsed.at > from ? [parsed.at] : [];
	if (parsed.kind === "every")
		return Array.from(
			{ length: count },
			(_, i) => new Date(from.getTime() + parsed.ms * (i + 1)),
		);
	return new Cron(parsed.expression, { timezone }).nextRuns(count, from);
}

/**
 * Roughly how often this fires, in milliseconds, or undefined for a one-shot.
 *
 * Measured from the next two fires rather than derived from the expression:
 * `0 0 9 * * 1-5` has no single interval, and the gap to the next fire is the
 * number the TTL actually cares about.
 */
export function intervalMs(
	spec: string,
	timezone = "UTC",
	from: Date = new Date(),
): number | undefined {
	const parsed = parseSchedule(spec);
	if (parsed.kind === "at") return undefined;
	if (parsed.kind === "every") return parsed.ms;
	const [first, second] = nextFires(spec, timezone, 2, from);
	if (!first || !second) return undefined;
	return second.getTime() - first.getTime();
}

/** A one-line description, for the portal to show under the input. */
export function describeSchedule(spec: string, timezone = "UTC"): string {
	const parsed = parseSchedule(spec);
	if (parsed.kind === "at") return `Once, at ${parsed.at.toISOString()}`;
	if (parsed.kind === "every") return `Every ${humanizeMs(parsed.ms)}`;
	const zone = timezone === "UTC" ? "UTC" : `${timezone} time`;
	return `${humanizeCron(parsed.expression)} (${zone})`;
}

/**
 * Spreads schedules that share a wall-clock instant.
 *
 * Every `@daily` trigger on an instance is `0 0 0 * * *`, so without this they
 * all fire on the same second and the first minute of the day is a thundering
 * herd. Rewriting the seconds field — and only when the user left it at `0`,
 * so an explicit second is still honoured — moves each trigger to its own
 * second of that minute.
 *
 * Deterministic in the trigger id: the same trigger lands on the same second
 * across restarts, which is what makes the reconciler's republish a no-op
 * instead of a schedule that drifts every boot.
 */
export function applyJitter(spec: string, seed: string): string {
	const parsed = parseSchedule(spec);
	if (parsed.kind !== "cron") return spec.trim();
	const fields = parsed.expression.split(/\s+/);
	if (fields[0] !== "0") return parsed.expression;
	fields[0] = String(hash(seed) % 60);
	return fields.join(" ");
}

/** FNV-1a. Any stable hash would do; this one is four lines and needs no import. */
function hash(value: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

function humanizeMs(ms: number): string {
	for (const [unit, size] of [
		["hour", 3_600_000],
		["minute", 60_000],
		["second", 1_000],
	] as const) {
		if (ms % size === 0 && ms >= size) {
			const count = ms / size;
			return count === 1 ? unit : `${count} ${unit}s`;
		}
	}
	return `${ms}ms`;
}

/**
 * Enough of a description to catch a mistyped field, not a full English
 * translation of cron. The preview list below it is what a user actually reads
 * to confirm the schedule is the one they meant.
 */
function humanizeCron(expression: string): string {
	const [sec, min, hour, dom, month, dow] = expression.split(/\s+/);
	const time = (h: string, m: string, s: string) =>
		`${pad(h)}:${pad(m)}${s === "0" ? "" : `:${pad(s)}`}`;
	const fixed = (field?: string) => !!field && /^\d+$/.test(field);

	if (fixed(sec) && fixed(min) && fixed(hour)) {
		const at = `at ${time(hour!, min!, sec!)}`;
		if (dom === "*" && month === "*" && dow === "*") return `Every day ${at}`;
		if (dom === "*" && month === "*") return `${weekdays(dow!)} ${at}`;
		if (month === "*") return `Day ${dom} of every month ${at}`;
		return `Every year on ${dom}/${month} ${at}`;
	}
	if (fixed(sec) && fixed(min) && hour === "*") return `Every hour at :${pad(min!)}`;
	if (fixed(sec) && min === "*") return `Every minute at :${pad(sec!)}`;
	return `Cron ${expression}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdays(field: string): string {
	if (field === "1-5") return "Every weekday";
	const named = field
		.split(",")
		.map((day) => DAY_NAMES[Number(day) % 7])
		.filter(Boolean);
	return named.length && !field.includes("-") && !field.includes("/")
		? `Every ${named.join(", ")}`
		: `On days ${field}`;
}

const pad = (value: string) => value.padStart(2, "0");

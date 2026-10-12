import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(utc);

/** UTC server timestamp in the viewer's local zone, as a plain wall-clock. */
function parseUtc(date: Date | string) {
	// Ensure the date string is treated as UTC if it lacks timezone info
	const dateStr =
		typeof date === "string" && !date.endsWith("Z") && !date.includes("+") && !date.includes("-")
			? `${date}Z`
			: date;
	return dayjs(dateStr).local();
}

/** The exact moment, for a tooltip behind a relative "x ago" (#739). */
export function formatDateTime(date: Date | string) {
	return parseUtc(date).format("D MMM YYYY, HH:mm");
}

// Server timestamps are UTC; parse them as UTC and render in the viewer's
// local zone so "x ago" is correct (and never shows a future time).
export function getTimeAgo(date: Date | string) {
	const parsed = parseUtc(date);
	const now = dayjs();

	// If the server's clock is ahead of the client's clock, it might appear in the future.
	// Clamp future times to "just now" to prevent "in 15 mins" anomalies.
	if (parsed.isAfter(now)) {
		return "just now";
	}

	return parsed.fromNow();
}

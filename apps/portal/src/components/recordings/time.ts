const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/**
 * Full recorded date and time in the user's local timezone:
 * e.g. "23 Oct 2026, 14:32:08". Returns empty string if missing or invalid.
 */
export function formatAbsoluteTime(value: unknown): string {
	if (!value) return "";
	const date = new Date(value as string);
	if (Number.isNaN(date.getTime())) return "";

	const day = date.getDate();
	const month = MONTHS[date.getMonth()];
	const year = date.getFullYear();
	const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	const seconds = pad(date.getSeconds());

	return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Finer-grained relative time steps for recordings:
 * - 0 s: "just now"
 * - 1–10 s: each second ("1s ago" … "10s ago")
 * - 11–20 s: "20s ago"
 * - 21–59 s: "30s ago" until 1 min
 * - >=1 min: as today ("1m ago", "2h ago", …)
 */
export function formatRelativeTime(value: unknown, now: number = Date.now()): string {
	if (!value) return "—";
	const date = new Date(value as string);
	if (Number.isNaN(date.getTime())) return "—";

	const elapsed = now - date.getTime();
	if (elapsed < 1000) return "just now";

	const seconds = Math.floor(elapsed / 1000);
	if (seconds <= 10) return `${seconds}s ago`;
	if (seconds <= 20) return "20s ago";
	if (seconds < 60) return "30s ago";

	const minutes = Math.max(1, Math.round(elapsed / 60_000));
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
	return date.toLocaleString();
}

/** Maps a harness conversation/run status to a human label + chip color.
 *  Shared by the recent-list cards and the sidebar so formatting stays DRY. */
export type StatusColor = "default" | "accent" | "success" | "warning" | "danger";

const IN_PROGRESS = new Set([
	"queued",
	"routing",
	"verifying",
	"planning",
	"orchestrating",
	"executing",
	"running",
]);

const humanize = (s: string) =>
	s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function statusMeta(status: string): { label: string; color: StatusColor } {
	const s = status.toLowerCase();
	if (s === "completed") return { label: "Completed", color: "success" };
	if (s === "failed" || s === "interrupted")
		return { label: humanize(s), color: "danger" };
	if (s === "awaiting_hitl" || s === "paused_hitl")
		return { label: "Awaiting input", color: "warning" };
	if (IN_PROGRESS.has(s)) return { label: humanize(s), color: "accent" };
	return { label: humanize(s), color: "default" };
}

/** Tailwind bg class for the small status dot in the sidebar. */
export function statusDotClass(color: StatusColor): string {
	switch (color) {
		case "success":
			return "bg-success";
		case "warning":
			return "bg-warning";
		case "danger":
			return "bg-danger";
		case "accent":
			return "bg-accent";
		default:
			return "bg-muted";
	}
}

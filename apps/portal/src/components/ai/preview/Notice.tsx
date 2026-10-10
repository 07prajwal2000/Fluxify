import type { ReactNode } from "react";
import { TbAlertTriangle, TbInfoCircle } from "react-icons/tb";

const TONE = {
	danger: "border-danger/40 bg-danger/10",
	warning: "border-warning/40 bg-warning/10",
	info: "border-border bg-surface",
} as const;
const ICON = {
	danger: "text-danger",
	warning: "text-warning",
	info: "text-muted",
} as const;

/** A line above a preview that must not be missed: an error, a warning, or a plain note. */
export function Notice({
	tone = "info",
	children,
}: {
	tone?: keyof typeof TONE;
	children: ReactNode;
}) {
	const Icon = tone === "info" ? TbInfoCircle : TbAlertTriangle;
	return (
		<div
			role={tone === "danger" ? "alert" : undefined}
			className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs text-foreground ${TONE[tone]}`}
		>
			<Icon size={14} className={`mt-0.5 shrink-0 ${ICON[tone]}`} />
			<div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</div>
		</div>
	);
}

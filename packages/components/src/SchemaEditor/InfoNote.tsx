import clsx from "clsx";
import type { ReactNode } from "react";
import { TbInfoCircle } from "react-icons/tb";

/** The one callout style used across the editor's tabs, drawer and panels. */
export function InfoNote({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={clsx(
				"flex gap-2 rounded-[var(--radius)] border border-border bg-surface p-3",
				className,
			)}
		>
			<TbInfoCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
			<div className="text-xs leading-relaxed text-muted-foreground">
				{children}
			</div>
		</div>
	);
}

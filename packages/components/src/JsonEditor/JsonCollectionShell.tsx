import type { ReactNode } from "react";
import { TbChevronDown } from "react-icons/tb";

interface JsonCollectionShellProps {
	type: "object" | "array";
	count: number;
	depth: number;
	children: ReactNode;
}

export function JsonCollectionShell({
	type,
	count,
	depth,
	children,
}: JsonCollectionShellProps) {
	const isObject = type === "object";
	const openingToken = isObject ? "{" : "[";
	const closingToken = isObject ? "}" : "]";
	const countLabel = `${count} ${isObject ? (count === 1 ? "field" : "fields") : count === 1 ? "item" : "items"}`;

	const content = (
		<div className="flex flex-col gap-2.5">
			<span aria-hidden="true" className="font-mono text-xs font-semibold text-muted">
				{openingToken}
			</span>
			<div className="flex flex-col gap-2 border-l border-border pl-3">
				{children}
			</div>
			<span aria-hidden="true" className="font-mono text-xs font-semibold text-muted">
				{closingToken}
			</span>
		</div>
	);

	if (depth === 0) {
		return (
			<div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-background p-3">
				{content}
			</div>
		);
	}

	return (
		<details
			className="group overflow-hidden rounded-[var(--radius)] border border-border bg-background"
			open
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius)] bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
				<TbChevronDown
					aria-hidden="true"
					className="size-4 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
				/>
				<span className="font-mono">{isObject ? "Object" : "Array"}</span>
				<span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-normal text-muted">
					{countLabel}
				</span>
			</summary>
			<div className="overflow-x-auto border-t border-border p-3">
				<div className="flex flex-col gap-2 border-l border-border pl-3">
					{children}
				</div>
			</div>
		</details>
	);
}

import { Chip } from "@fluxify/components";
import type { ReactNode } from "react";

/**
 * The method chip of a routes row. A route that production serves turns green
 * and starts with a `P`; `ProductionLegend` under the table names it (#1004).
 * `children` carries the recording dots, which sit before the method.
 */
export function MethodPill({
	method,
	inProduction,
	children,
}: {
	method?: string | null;
	inProduction?: boolean | null;
	children?: ReactNode;
}) {
	return (
		<Chip
			color={inProduction ? "success" : undefined}
			title={inProduction ? "In production: active, with a promoted version" : undefined}
		>
			<span className="flex items-center gap-1.5">
				{children}
				{inProduction && (
					<span className="font-bold" role="img" aria-label="In production">
						P
					</span>
				)}
				{method}
			</span>
		</Chip>
	);
}

export function ProductionLegend() {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground">
			<Chip size="sm" color="success">
				<span className="font-bold">P</span>
			</Chip>
			<span>In production (active, with a promoted version)</span>
		</span>
	);
}

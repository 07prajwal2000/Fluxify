import { Chip } from "@fluxify/components";
import type { ReactNode } from "react";
import { TbRocket } from "react-icons/tb";

/**
 * The method chip of a routes row. A route that production serves turns green
 * and starts with a rocket and a `P`, as the canvas header's production chip does; `ProductionLegend` under the table names it (#1004).
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
				{inProduction && <ProductionMark />}
				{children}
				{method}
			</span>
		</Chip>
	);
}

/** the rocket the canvas header's production chip uses, then a P */
function ProductionMark() {
	return (
		<span
			className="inline-flex items-center gap-0.5 font-bold"
			role="img"
			aria-label="In production"
		>
			<TbRocket size={12} aria-hidden />
			<span aria-hidden>P</span>
		</span>
	);
}

export function ProductionLegend() {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground">
			<Chip size="sm" color="success">
				<ProductionMark />
			</Chip>
			<span>In production (active, with a promoted version)</span>
		</span>
	);
}

import { cn, Tooltip } from "@fluxify/components";
import { TbRocket } from "react-icons/tb";

const BASE = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium";
const LIVE = "border-success/40 bg-success/10 text-success";

/**
 * Sits next to a route's Active switch when production serves it: active, with
 * a promoted version. The same rocket chip as the canvas header's (#1004).
 */
export function ProductionBadge() {
	return (
		<Tooltip delay={200}>
			<Tooltip.Trigger render={(props) => <span {...props} className={cn(BASE, LIVE)} />}>
				<TbRocket size={13} aria-hidden />
				Prod
			</Tooltip.Trigger>
			<Tooltip.Content className="whitespace-nowrap">
				In production: active, with a promoted version
			</Tooltip.Content>
		</Tooltip>
	);
}

/** names the chip, under the table; shown only when a listed route has one */
export function ProductionLegend() {
	return (
		<span className={cn(BASE, "border-border bg-surface text-foreground")}>
			<span className={cn(BASE, LIVE, "px-1.5 py-0")}>
				<TbRocket size={13} aria-hidden />
				Prod
			</span>
			<span>In production (active, with a promoted version)</span>
		</span>
	);
}

import type { ReactNode } from "react";
import { Chip, Tooltip, cn } from "@fluxify/components";
import { TbLock } from "react-icons/tb";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";

/**
 * Enterprise hints. All of them render nothing while enterprise features are
 * available (an active or non-commercial license), so they can be dropped
 * anywhere without a check at the call site.
 */

/** True when enterprise features can be created. Assumed true until the settings load, so nothing flashes. */
export function useEnterprise() {
	const { data } = publicSettingsQuery.get.useQuery();
	return data?.license.canCreate ?? true;
}

const REASON = "Needs an Enterprise license.";

/** A small "Enterprise" chip, e.g. next to a title. */
export function EnterpriseChip({ className }: { className?: string }) {
	if (useEnterprise()) return null;
	return (
		<Tooltip>
			<Chip size="sm" color="warning" className={cn("gap-1", className)}>
				<TbLock size={12} />
				Enterprise
			</Chip>
			<Tooltip.Content>{REASON}</Tooltip.Content>
		</Tooltip>
	);
}

/**
 * Wraps a panel or card. Without a license the content is dimmed, can't be
 * clicked or focused, and an overlay explains why.
 */
export function EnterpriseGate({
	children,
	title = "Enterprise only",
	description = REASON,
	compact,
	className,
}: {
	children: ReactNode;
	title?: string;
	description?: string;
	/** Chip only, for cards too small to hold a message. */
	compact?: boolean;
	className?: string;
}) {
	if (useEnterprise()) return <>{children}</>;
	return (
		<div className={cn("relative", className)}>
			<div inert className="pointer-events-none select-none opacity-40 blur-[1px]">
				{children}
			</div>
			<div
				role="note"
				className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-warning/50 bg-background/40 p-3 text-center"
			>
				<Chip size="sm" color="warning" className="gap-1">
					<TbLock size={12} />
					{title}
				</Chip>
				{!compact && <p className="max-w-xs text-xs text-muted">{description}</p>}
			</div>
		</div>
	);
}

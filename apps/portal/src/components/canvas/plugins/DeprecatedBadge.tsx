import { cn } from "@fluxify/components";
import { TbAlertTriangle } from "react-icons/tb";

/** A deprecated plugin block; the message its author wrote is the tooltip. */
export function DeprecatedBadge({ message, className }: { message: string; className?: string }) {
	return (
		<span
			role="img"
			title={message}
			aria-label={`Deprecated: ${message}`}
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning",
				className,
			)}
		>
			<TbAlertTriangle size={10} aria-hidden />
			Deprecated
		</span>
	);
}

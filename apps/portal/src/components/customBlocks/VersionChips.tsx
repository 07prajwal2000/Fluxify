import { cn } from "@fluxify/components";
import { useVersionTarget } from "@/components/versions/useVersionTarget";

const chip = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

/**
 * Which version runs where (#803): development always runs the working copy, so
 * its chip says what that copy came from; production runs the promoted version,
 * or nothing until one is. A block is usable in development either way.
 */
export function VersionChips({ blockId, className }: { blockId: string; className?: string }) {
	const { headVersionNumber, prodVersionNumber, uncommitted } = useVersionTarget(
		"custom_block",
		blockId,
	);
	const base = headVersionNumber ? `from v${headVersionNumber}` : "working copy";
	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", className)}>
			<span
				className={cn(chip, "border-border bg-surface text-foreground")}
				title="Development runs the working copy"
			>
				Dev {base}
				{uncommitted && headVersionNumber ? " + changes" : ""}
			</span>
			<span
				className={cn(
					chip,
					prodVersionNumber
						? "border-success/40 bg-success/10 text-success"
						: "border-border bg-surface text-muted",
				)}
				title={
					prodVersionNumber
						? `Production runs v${prodVersionNumber}`
						: "No version is promoted, so production does not have this block yet"
				}
			>
				{prodVersionNumber ? `Prod v${prodVersionNumber}` : "Not in production"}
			</span>
		</div>
	);
}

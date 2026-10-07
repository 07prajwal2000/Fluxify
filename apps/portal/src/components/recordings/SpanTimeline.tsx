import { Chip, cn } from "@fluxify/components";
import { useMemo } from "react";
import { formatDuration } from "@/components/testSuites/CaseResults";
import type { RecordedSpan } from "@/services/recordings";
import { OutcomeIcon } from "./RecordedRunList";
import { spanMs, spansAt } from "./spans";

/**
 * Waterfall timeline showing relative timing and durations of recorded spans.
 * Allows quick identification of slow blocks and bottlenecks.
 */
export function SpanTimeline({
	level,
	allSpans,
	selected,
	onSelect,
	nameOf,
}: {
	level: RecordedSpan[];
	allSpans: RecordedSpan[];
	selected: string | null;
	onSelect: (blockId: string | null) => void;
	nameOf: (span: RecordedSpan) => string;
}) {
	const items = useMemo(() => {
		const list: { span: RecordedSpan; isStep?: boolean }[] = [];
		for (const span of level) {
			list.push({ span });
			if (span.middleware) {
				for (const step of spansAt(allSpans, span.seq)) {
					list.push({ span: step, isStep: true });
				}
			}
		}
		return list;
	}, [level, allSpans]);

	const { minStart, totalMs } = useMemo(() => {
		if (items.length === 0) return { minStart: 0, totalMs: 1 };
		const starts = items.map((i) => Date.parse(i.span.startedAt)).filter((t) => !Number.isNaN(t));
		const ends = items.map((i) => Date.parse(i.span.endedAt)).filter((t) => !Number.isNaN(t));
		const min = starts.length > 0 ? Math.min(...starts) : 0;
		const max = ends.length > 0 ? Math.max(...ends) : min + 1;
		return { minStart: min, totalMs: Math.max(1, max - min) };
	}, [items]);

	if (items.length === 0) {
		return <p className="p-6 text-center text-xs text-muted">No blocks to display in timeline.</p>;
	}

	return (
		<div className="space-y-3 p-4">
			<div className="flex items-center justify-between text-[11px] text-muted">
				<span>Timeline Waterfall</span>
				<span>Total: {formatDuration(totalMs)}</span>
			</div>

			{/* Timeline Ruler */}
			<div className="flex items-center border-b border-border pb-1 text-[10px] text-muted font-mono">
				<div className="w-48 shrink-0 pr-2">Block</div>
				<div className="relative flex-1">
					<span className="absolute left-0">0ms</span>
					<span className="absolute left-1/4 -translate-x-1/2">
						{formatDuration(totalMs * 0.25)}
					</span>
					<span className="absolute left-1/2 -translate-x-1/2">
						{formatDuration(totalMs * 0.5)}
					</span>
					<span className="absolute left-3/4 -translate-x-1/2">
						{formatDuration(totalMs * 0.75)}
					</span>
					<span className="absolute right-0">{formatDuration(totalMs)}</span>
				</div>
			</div>

			{/* Waterfall Rows */}
			<div className="space-y-1.5">
				{items.map(({ span, isStep }) => {
					const duration = spanMs(span);
					const offset = Math.max(0, Date.parse(span.startedAt) - minStart);
					const leftPct = Math.min(99, Math.max(0, (offset / totalMs) * 100));
					const widthPct = Math.min(100 - leftPct, Math.max(1.5, (duration / totalMs) * 100));
					const isSlow = totalMs > 20 && duration >= totalMs * 0.35;
					const isSelected = selected === span.blockId;

					return (
						<button
							key={span.seq}
							type="button"
							onClick={() => onSelect(span.blockId)}
							className={cn(
								"flex w-full cursor-pointer items-center rounded-md px-2 py-1 text-left transition-colors",
								isSelected ? "bg-accent/15 ring-1 ring-accent" : "hover:bg-surface-secondary",
								isStep && "pl-5",
							)}
						>
							<div className="flex w-48 shrink-0 items-center gap-2 pr-2">
								<OutcomeIcon outcome={span.outcome} />
								<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
									{nameOf(span)}
								</span>
								<span className="font-mono text-[11px] text-muted">{formatDuration(duration)}</span>
							</div>

							<div className="relative h-4 flex-1 rounded bg-background-secondary/60">
								<div
									className={cn(
										"absolute top-0.5 bottom-0.5 rounded transition-all",
										span.outcome === "failure" ? "bg-danger" : isSlow ? "bg-warning" : "bg-success",
									)}
									style={{
										left: `${leftPct}%`,
										width: `${widthPct}%`,
									}}
									title={`${nameOf(span)}: ${formatDuration(duration)} (started at +${formatDuration(offset)})`}
								/>
							</div>

							{isSlow && (
								<Chip size="sm" color="warning" className="ml-2 shrink-0 text-[10px]">
									Slow
								</Chip>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

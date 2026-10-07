import { Button, Chip, cn } from "@fluxify/components";
import { useState } from "react";
import { TbArrowLeft, TbArrowRight, TbExternalLink } from "react-icons/tb";
import { formatDuration } from "@/components/testSuites/CaseResults";
import type { RecordedRun, RecordedSpan } from "@/services/recordings";
import { PayloadViewer } from "./PayloadViewer";
import { OutcomeIcon } from "./RecordedRunList";
import { SpanTimeline } from "./SpanTimeline";
import { calledBlockId, spanMs, spansAt } from "./spans";

export type SpanActions = {
	/** a human name for a span: its own name, its custom block's label, or its type */
	nameOf: (span: RecordedSpan) => string;
	/** draw the custom block this span called, with the spans of this call */
	openCall: (span: RecordedSpan, customBlockId: string) => void;
	/** open the async run this span forked */
	openChild: (runId: string, span: RecordedSpan) => void;
};

function SpanCard({
	run,
	span,
	index,
	count,
	actions,
}: {
	run: RecordedRun;
	span: RecordedSpan;
	index: number;
	count: number;
	actions: SpanActions;
}) {
	const called = calledBlockId(run.spans, span);
	const children = run.childRuns.filter((child) => child.parentSeq === span.seq);
	return (
		<div className="space-y-3 rounded-lg border border-border bg-background-secondary p-3">
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<OutcomeIcon outcome={span.outcome} />
				<span className="font-medium text-foreground">
					{count > 1
						? `Run ${index + 1} of ${count}`
						: span.outcome === "success"
							? "Passed"
							: "Failed"}
				</span>
				<span className="text-muted">{formatDuration(spanMs(span))}</span>
				{span.branch && <Chip size="sm">Took {span.branch}</Chip>}
				{span.truncated && (
					<Chip size="sm" color="warning" title="Cut to fit the 8 KB recording limit per span">
						Truncated at 8 KB
					</Chip>
				)}
			</div>
			{span.error && (
				<pre className="whitespace-pre-wrap break-words rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
					{span.error}
				</pre>
			)}
			{(called || children.length > 0) && (
				<div className="flex flex-wrap gap-2">
					{called && (
						<Button size="sm" variant="outline" onPress={() => actions.openCall(span, called)}>
							Open {actions.nameOf(span)} <TbArrowRight size={14} />
						</Button>
					)}
					{children.map((child) => (
						<Button
							key={child.id}
							size="sm"
							variant="outline"
							onPress={() => actions.openChild(child.id, span)}
						>
							Open async run <TbExternalLink size={14} />
						</Button>
					))}
				</div>
			)}
			<PayloadViewer
				title="Input"
				value={span.input}
				truncated={span.truncated}
				mocked={span.metadata?.mocked.input}
			/>
			<PayloadViewer
				title="Output"
				value={span.output}
				truncated={span.truncated}
				mocked={span.metadata?.mocked.output}
			/>
		</div>
	);
}

function SpanRow({
	span,
	nameOf,
	onSelect,
}: {
	span: RecordedSpan;
	nameOf: (span: RecordedSpan) => string;
	onSelect: (blockId: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(span.blockId)}
			className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-secondary"
		>
			<OutcomeIcon outcome={span.outcome} />
			<span className="min-w-0 flex-1 truncate text-foreground">{nameOf(span)}</span>
			<span className="text-muted">{formatDuration(spanMs(span))}</span>
		</button>
	);
}

/**
 * The right-hand pane. Nothing selected: toggle between list and waterfall timeline,
 * with middlewares (chains, not canvases) grouped under their own heading.
 * A block selected: each of its runs — input, output, duration, error.
 */
export function SpanDetail({
	run,
	level,
	selected,
	onSelect,
	actions,
}: {
	run: RecordedRun;
	level: RecordedSpan[];
	selected: string | null;
	onSelect: (blockId: string | null) => void;
	actions: SpanActions;
}) {
	const [viewMode, setViewMode] = useState<"list" | "timeline">("list");
	const middlewares = level.filter((span) => span.middleware);
	const steps = middlewares.flatMap((span) => spansAt(run.spans, span.seq));
	const picked = selected ? [...level, ...steps].filter((span) => span.blockId === selected) : [];

	if (selected) {
		return (
			<div className="h-full space-y-3 overflow-y-auto p-4">
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						isIconOnly
						aria-label="All blocks"
						onPress={() => onSelect(null)}
					>
						<TbArrowLeft size={16} />
					</Button>
					{picked[0] && (
						<>
							<h3 className="truncate text-sm font-semibold text-foreground">
								{actions.nameOf(picked[0])}
							</h3>
							<span className="font-mono text-xs text-muted">{picked[0].blockType}</span>
						</>
					)}
				</div>
				{picked.length === 0 && (
					<p className="text-xs text-muted">This block did not run in this recording.</p>
				)}
				{picked.map((span, index) => (
					<SpanCard
						key={span.seq}
						run={run}
						span={span}
						index={index}
						count={picked.length}
						actions={actions}
					/>
				))}
			</div>
		);
	}

	if (level.length === 0) {
		return <p className="p-6 text-center text-xs text-muted">No blocks were recorded here.</p>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
				<p className="text-xs text-muted">
					{viewMode === "list"
						? "Select a block on the canvas or below."
						: "Waterfall timeline of recorded execution."}
				</p>
				<div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
					<button
						type="button"
						onClick={() => setViewMode("list")}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
							viewMode === "list" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground",
						)}
					>
						List
					</button>
					<button
						type="button"
						onClick={() => setViewMode("timeline")}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
							viewMode === "timeline"
								? "bg-accent/10 text-accent"
								: "text-muted hover:text-foreground",
						)}
					>
						Timeline
					</button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{viewMode === "timeline" ? (
					<SpanTimeline
						level={level}
						allSpans={run.spans}
						selected={selected}
						onSelect={onSelect}
						nameOf={actions.nameOf}
					/>
				) : (
					<div className="space-y-1 p-4">
						{level.map((span) =>
							span.middleware ? (
								<div key={span.seq} className="space-y-1 rounded-md border border-border p-2">
									<div className="flex items-center gap-2 px-2 text-xs">
										<OutcomeIcon outcome={span.outcome} />
										<span className="flex-1 font-medium text-foreground">
											Middleware · {span.middleware.name}
										</span>
										<span className="text-muted">{span.middleware.phase}</span>
										<span className="text-muted">{formatDuration(spanMs(span))}</span>
									</div>
									{spansAt(run.spans, span.seq).map((step) => (
										<SpanRow
											key={step.seq}
											span={step}
											nameOf={actions.nameOf}
											onSelect={onSelect}
										/>
									))}
								</div>
							) : (
								<SpanRow key={span.seq} span={span} nameOf={actions.nameOf} onSelect={onSelect} />
							),
						)}
					</div>
				)}
			</div>
		</div>
	);
}

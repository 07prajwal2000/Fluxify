import { Button, Chip, CodeViewer } from "@fluxify/components";
import { TbArrowLeft, TbArrowRight, TbExternalLink } from "react-icons/tb";
import { formatDuration } from "@/components/testSuites/CaseResults";
import type { RecordedRun, RecordedSpan } from "@/services/recordings";
import { OutcomeIcon } from "./RecordedRunList";
import { calledBlockId, spanMs, spansAt } from "./spans";

export type SpanActions = {
	/** a human name for a span: its own name, its custom block's label, or its type */
	nameOf: (span: RecordedSpan) => string;
	/** draw the custom block this span called, with the spans of this call */
	openCall: (span: RecordedSpan, customBlockId: string) => void;
	/** open the async run this span forked */
	openChild: (runId: string, span: RecordedSpan) => void;
};

const asJson = (value: unknown) =>
	value === undefined || value === null ? "" : JSON.stringify(value, null, 2);

function Payload({ title, value }: { title: string; value: unknown }) {
	const text = asJson(value);
	return (
		<div className="space-y-1">
			<p className="text-xs font-medium text-muted">{title}</p>
			{text ? (
				<CodeViewer value={text} language="json" height={160} />
			) : (
				<p className="text-xs text-muted">Nothing recorded.</p>
			)}
		</div>
	);
}

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
					<Chip size="sm" color="warning" title="Cut to fit the recording limit">
						Truncated
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
			<Payload title="Input" value={span.input} />
			<Payload title="Output" value={span.output} />
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
 * The right-hand pane. Nothing selected: every block this level ran, in order,
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
		<div className="h-full space-y-1 overflow-y-auto p-4">
			<p className="pb-2 text-xs text-muted">
				Select a block on the canvas or below to see what it received and returned.
			</p>
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
							<SpanRow key={step.seq} span={step} nameOf={actions.nameOf} onSelect={onSelect} />
						))}
					</div>
				) : (
					<SpanRow key={span.seq} span={span} nameOf={actions.nameOf} onSelect={onSelect} />
				),
			)}
		</div>
	);
}

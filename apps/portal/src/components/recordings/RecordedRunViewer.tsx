import { Breadcrumbs, Button, DeleteButton, Spinner } from "@fluxify/components";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TbArrowLeft } from "react-icons/tb";
import { SplitPane } from "@/components/common/SplitPane";
import { formatDuration } from "@/components/testSuites/CaseResults";
import { FromTestLink } from "@/components/testSuites/FromTestLink";
import { formatWhen } from "@/components/testSuites/RunResults";
import { showErrorNotification } from "@/lib/errorNotifier";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { recordingsQuery } from "@/query/recordingsQuery";
import type { RecordedSpan, RecordingTarget } from "@/services/recordings";
import { OverlayCanvas } from "./OverlayCanvas";
import { IncompleteChip, OutcomeIcon } from "./RecordedRunList";
import { type SpanActions, SpanDetail } from "./SpanDetail";
import { type Frame, rootCanvasId, spansAt } from "./spans";

const TARGET_LABEL: Record<RecordingTarget["type"], string> = {
	route: "Route",
	workflow: "Workflow",
	sandbox: "Sandbox",
};

/**
 * One recorded run: the canvas it ran on (30%) next to the span detail (70%).
 * Opening a custom block call or an async run pushes a level; the breadcrumb
 * walks back up (`Route > Block A > Block B`).
 */
export function RecordedRunViewer({
	projectId,
	target,
	runId,
	onBack,
	initialSelected = null,
}: {
	projectId: string;
	target: RecordingTarget;
	runId: string;
	onBack: () => void;
	/** the block to open on, e.g. the one a failed test case failed in (#627) */
	initialSelected?: string | null;
}) {
	const [frames, setFrames] = useState<Frame[]>([
		{
			runId,
			parentSeq: null,
			customBlockId: null,
			label: TARGET_LABEL[target.type],
		},
	]);
	const [selected, setSelected] = useState<string | null>(initialSelected);
	const frame = frames[frames.length - 1];
	const run = recordingsQuery.getRun.useQuery(projectId, target, frame.runId);
	const root = recordingsQuery.getRun.useQuery(projectId, target, runId).data;
	const remove = recordingsQuery.deleteRun.useMutation(projectId, target);
	const { data: customBlocks } = customBlocksQuery.getAll.useQuery(projectId);

	const spans = run.data?.spans;
	const level = useMemo(() => (spans ? spansAt(spans, frame.parentSeq) : []), [spans, frame]);
	// a run's own level sits on the target's canvas, or an async run's custom block
	const canvasId = frame.parentSeq === null ? rootCanvasId(spans ?? []) : frame.customBlockId;

	const goTo = useCallback((depth: number) => {
		setFrames((current) => current.slice(0, depth + 1));
		setSelected(null);
	}, []);
	const push = useCallback((next: Frame) => {
		setFrames((current) => [...current, next]);
		setSelected(null);
	}, []);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				if (frames.length > 1) {
					goTo(frames.length - 2);
				} else {
					onBack();
				}
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [frames.length, onBack, goTo]);

	const nameOf = (span: RecordedSpan) =>
		span.blockName ||
		customBlocks?.find((block) => block.name === span.blockType)?.label ||
		span.blockType;
	const actions: SpanActions = {
		nameOf,
		openCall: (span, customBlockId) =>
			push({ runId: frame.runId, parentSeq: span.seq, customBlockId, label: nameOf(span) }),
		openChild: (childId, span) =>
			push({
				runId: childId,
				parentSeq: null,
				customBlockId: null,
				label: `${nameOf(span)} (async)`,
			}),
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
				<Button size="sm" variant="ghost" onPress={onBack}>
					<TbArrowLeft size={14} /> All runs
				</Button>
				<Breadcrumbs onAction={(key) => goTo(Number(key))}>
					{frames.map((item, depth) => (
						<Breadcrumbs.Item key={`${item.runId}:${item.parentSeq}`} id={String(depth)}>
							{depth === 0 && root?.metadata ? root.metadata.label : item.label}
						</Breadcrumbs.Item>
					))}
				</Breadcrumbs>
				{root && (
					<div className="ml-auto flex items-center gap-3 text-xs text-muted">
						{root.metadata && target.type !== "sandbox" && (
							<FromTestLink projectId={projectId} target={target} metadata={root.metadata} />
						)}
						<OutcomeIcon outcome={root.outcome} />
						{root.statusCode != null && (
							<span className="font-mono text-foreground">{root.statusCode}</span>
						)}
						<span>{formatWhen(root.startedAt)}</span>
						<span>{formatDuration(root.durationMs)}</span>
						<IncompleteChip run={root} />
						{/* a sandbox keeps its runs until it is deleted: there is nothing to delete one with */}
						{target.type !== "sandbox" && (
							<DeleteButton
								size="sm"
								isPending={remove.isPending}
								onPress={() =>
									remove.mutate(runId, {
										onSuccess: onBack,
										onError: (error: Error) => showErrorNotification(error),
									})
								}
							>
								Delete run
							</DeleteButton>
						)}
					</div>
				)}
			</div>
			<div className="min-h-0 flex-1">
				{run.isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : !run.data ? (
					<div className="flex h-full items-center justify-center text-xs text-muted">
						Couldn't load this run. It may have been deleted or expired.
					</div>
				) : (
					<SplitPane
						initial={50}
						label="Resize canvas and details"
						left={
							<OverlayCanvas
								key={`${frame.runId}:${frame.parentSeq}`}
								projectId={projectId}
								target={target}
								customBlockId={canvasId}
								level={level}
								runSpans={spans}
								selectedId={selected}
								onSelect={setSelected}
								onOpenCall={actions.openCall}
							/>
						}
						right={
							<SpanDetail
								run={run.data}
								level={level}
								selected={selected}
								onSelect={setSelected}
								actions={actions}
							/>
						}
					/>
				)}
			</div>
		</div>
	);
}

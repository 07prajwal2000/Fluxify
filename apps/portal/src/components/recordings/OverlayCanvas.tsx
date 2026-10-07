import { Button, Spinner } from "@fluxify/components";
import { type EdgeProps, useOnSelectionChange, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { TbArrowRight } from "react-icons/tb";
import { BlockCanvas } from "@/components/canvas/BlockCanvas";
import { createBlockNodeTypes } from "@/components/canvas/blocks";
import { toGraph } from "@/components/canvas/CanvasWorkbench";
import { CanvasDiagnosticsProvider } from "@/components/canvas/diagnostics";
import { FLOW_EDGE_TYPE, FlowEdge } from "@/components/canvas/edges";
import type { BlockEdge, BlockNode } from "@/components/canvas/types";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { RecordedSpan, RecordingTarget } from "@/services/recordings";
import { GhostNode } from "./GhostNode";
import { calledBlockId, GHOST_NODE_TYPE, overlayGraph, takenEdgeIds } from "./spans";
import "./recordings.css";

const nodeTypes = createBlockNodeTypes({ [GHOST_NODE_TYPE]: GhostNode });

function SelectionSync({
	selectedId,
	onSelect,
}: {
	selectedId?: string | null;
	onSelect: (blockId: string | null) => void;
}) {
	const { setNodes } = useReactFlow();

	const onChange = useCallback(
		({ nodes }: { nodes: BlockNode[] }) => {
			const activeId = nodes[0]?.id ?? null;
			if (activeId !== selectedId) {
				onSelect(activeId);
			}
		},
		[onSelect, selectedId],
	);
	useOnSelectionChange({ onChange });

	useEffect(() => {
		setNodes((nodes) =>
			nodes.map((node) => ({
				...node,
				selected: node.id === selectedId,
			})),
		);
	}, [selectedId, setNodes]);

	return null;
}

/** the saved canvas a level ran on: the target's own, or a custom block's */
function useLevelCanvas(target: RecordingTarget, customBlockId: string | null) {
	const own = customBlockId === null;
	const route = routesQuery.canvasItems.useQuery(own && target.type === "route" ? target.id : "");
	const workflow = workflowsQuery.canvasItems.useQuery(
		own && target.type === "workflow" ? target.id : "",
	);
	const block = customBlocksQuery.canvasItems.useQuery(customBlockId ?? "");
	if (!own) return block;
	return target.type === "route" ? route : workflow;
}

/**
 * The current canvas in readonly mode, tinted by what ran: passed / failed
 * through the blocks' own status outline, not-run blocks dimmed, the taken
 * edges lit. A block gone from the canvas since is drawn as a ghost where it
 * was, when its span recorded that (#628).
 */
export function OverlayCanvas({
	target,
	customBlockId,
	level,
	runSpans,
	selectedId,
	onSelect,
	onOpenCall,
}: {
	target: RecordingTarget;
	customBlockId: string | null;
	level: RecordedSpan[];
	runSpans?: RecordedSpan[];
	selectedId?: string | null;
	onSelect: (blockId: string | null) => void;
	onOpenCall?: (span: RecordedSpan, customBlockId: string) => void;
}) {
	const items = useLevelCanvas(target, customBlockId);
	const { graph, lost } = useMemo(
		() => overlayGraph(toGraph(items.data), level),
		[items.data, level],
	);
	// the canvas's own edge, wrapped so the taken ones can be lit; fixed per level
	// (the parent remounts this per level), so React Flow sees one stable map
	const edgeTypes = useMemo(() => {
		const taken = new Set(takenEdgeIds(graph.edges, level));
		return {
			[FLOW_EDGE_TYPE]: (props: EdgeProps<BlockEdge>) => (
				<g className={taken.has(props.id) ? "fx-edge--taken" : undefined}>
					<FlowEdge {...props} />
				</g>
			),
		};
	}, [graph.edges, level]);

	const activeSpan = selectedId ? level.find((s) => s.blockId === selectedId) : null;
	const activeCalledId = activeSpan && runSpans ? calledBlockId(runSpans, activeSpan) : null;

	const handleNodeDoubleClick = useCallback(
		(_: React.MouseEvent, node: BlockNode) => {
			if (!runSpans || !onOpenCall) return;
			const span = level.find((s) => s.blockId === node.id);
			if (!span) return;
			const called = calledBlockId(runSpans, span);
			if (called) {
				onOpenCall(span, called);
			}
		},
		[level, runSpans, onOpenCall],
	);

	if (items.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}
	if (items.isError) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
				Couldn't load this canvas. The block may have been deleted.
			</div>
		);
	}
	return (
		// its own diagnostics: the editor canvas behind must not pick up this one's blocks
		<CanvasDiagnosticsProvider>
			<div className="relative h-full w-full">
				<BlockCanvas
					graph={graph}
					mode="readonly"
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					enablePanel={false}
					enableHistory={false}
					enableFormat={false}
					enableClipboard={false}
					onNodeDoubleClick={handleNodeDoubleClick}
					className="fx-run-overlay"
				>
					<SelectionSync selectedId={selectedId} onSelect={onSelect} />
				</BlockCanvas>
				{lost > 0 && (
					<div className="pointer-events-none absolute top-3 left-3 z-10 rounded-lg border border-border bg-background-secondary/95 px-3 py-1.5 text-xs text-muted shadow-lg">
						{lost} {lost === 1 ? "span belongs" : "spans belong"} to removed blocks
					</div>
				)}
				{activeSpan && activeCalledId && onOpenCall && (
					<div className="pointer-events-auto absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-background-secondary/95 px-3 py-1.5 shadow-lg backdrop-blur">
						<span className="text-xs font-medium text-foreground">Custom block call</span>
						<Button
							size="sm"
							variant="outline"
							onPress={() => onOpenCall(activeSpan, activeCalledId)}
						>
							Open Call <TbArrowRight size={14} />
						</Button>
					</div>
				)}
			</div>
		</CanvasDiagnosticsProvider>
	);
}

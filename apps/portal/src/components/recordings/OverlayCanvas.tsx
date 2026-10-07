import { Spinner } from "@fluxify/components";
import { type EdgeProps, useOnSelectionChange } from "@xyflow/react";
import { useCallback, useMemo } from "react";
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
import { blockStatuses, takenEdgeIds } from "./spans";
import "./recordings.css";

const nodeTypes = createBlockNodeTypes();

function SelectionWatcher({ onSelect }: { onSelect: (blockId: string | null) => void }) {
	const onChange = useCallback(
		({ nodes }: { nodes: BlockNode[] }) => onSelect(nodes[0]?.id ?? null),
		[onSelect],
	);
	useOnSelectionChange({ onChange });
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
 * edges lit. Spans whose block is gone from the canvas just draw nothing.
 */
export function OverlayCanvas({
	target,
	customBlockId,
	level,
	onSelect,
}: {
	target: RecordingTarget;
	customBlockId: string | null;
	level: RecordedSpan[];
	onSelect: (blockId: string | null) => void;
}) {
	const items = useLevelCanvas(target, customBlockId);
	const graph = useMemo(() => {
		const saved = toGraph(items.data);
		const status = blockStatuses(level);
		return {
			blocks: saved.blocks.map((block) =>
				block.id in status
					? { ...block, data: { ...block.data, status: status[block.id] } }
					: block,
			),
			edges: saved.edges,
		};
	}, [items.data, level]);
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
			<BlockCanvas
				graph={graph}
				mode="readonly"
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				enablePanel={false}
				enableHistory={false}
				enableFormat={false}
				enableClipboard={false}
				className="fx-run-overlay"
			>
				<SelectionWatcher onSelect={onSelect} />
			</BlockCanvas>
		</CanvasDiagnosticsProvider>
	);
}

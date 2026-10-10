import { layoutGraph } from "@fluxify/blocks/layout";
import { type EdgeProps, type NodeProps, useOnSelectionChange, useReactFlow } from "@xyflow/react";
import {
	type ComponentType,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
} from "react";
import { BlockCanvas } from "@/components/canvas/BlockCanvas";
import { createBlockNodeTypes } from "@/components/canvas/blocks";
import { FLOW_EDGE_TYPE, FlowEdge } from "@/components/canvas/edges";
import type { BlockEdge, CanvasGraph } from "@/components/canvas/types";
import type { BlockStatus, CanvasDiff, DiffEdge } from "./canvasDiff";
import "./canvasDiff.css";

type Statuses = { blocks: Map<string, BlockStatus>; edges: Map<string, DiffEdge["status"]> };
const StatusContext = createContext<Statuses>({ blocks: new Map(), edges: new Map() });

const blockTypes = createBlockNodeTypes();

/** The canvas's own block for this type, in a wrapper that tints it for what happened to it. */
function DiffBlockNode(props: NodeProps) {
	const status = useContext(StatusContext).blocks.get(props.id) ?? "same";
	const Block = blockTypes[props.type] as ComponentType<NodeProps>;
	return (
		<div data-block-key={props.id} data-status={status} className={`fx-diff fx-diff--${status}`}>
			<Block {...props} />
		</div>
	);
}
// every block type draws as the canvas draws it; a type the canvas has no entry for falls back the same way
const nodeTypes = new Proxy(
	Object.fromEntries(Object.keys(blockTypes).map((type) => [type, DiffBlockNode])),
	{ get: (types, type: string) => (type in types ? types[type] : DiffBlockNode) },
);

/** The canvas's own edge, tinted for added and removed ones. */
function DiffEdgeLine(props: EdgeProps<BlockEdge>) {
	const status = useContext(StatusContext).edges.get(props.id) ?? "same";
	return (
		<g className={`fx-diff-edge--${status}`}>
			<FlowEdge {...props} />
		</g>
	);
}
const edgeTypes = { [FLOW_EDGE_TYPE]: DiffEdgeLine };

/** Positions from the canvas when every block has one, else laid out (a diff built from ops alone has none). */
function positions(diff: CanvasDiff) {
	if (diff.blocks.every((b) => b.position)) return undefined;
	const keys = new Set(diff.blocks.map((b) => b.key));
	return layoutGraph(
		diff.blocks.map((b) => ({ id: b.key, type: b.type })),
		diff.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
	);
}

/** Blocks are named by key here; handle ids are `<block>-<handle>`, as the canvas stores them. */
function toGraph(diff: CanvasDiff): CanvasGraph {
	const laid = positions(diff);
	const keys = new Set(diff.blocks.map((b) => b.key));
	// ops alone do not know a block's real handles: let the canvas pick its first
	const handles = !diff.partial;
	return {
		blocks: diff.blocks.map((b) => ({
			id: b.key,
			key: b.key,
			type: b.type,
			data: b.data,
			position: laid?.[b.key] ?? b.position ?? { x: 0, y: 0 },
		})),
		edges: diff.edges
			.filter((e) => keys.has(e.from) && keys.has(e.to))
			.map((e) => ({
				id: e.id,
				from: e.from,
				to: e.to,
				fromHandle: handles ? `${e.from}-${e.handle}` : "",
				toHandle: handles ? `${e.to}-target` : "",
			})),
	};
}

/** Clicking a block picks it; the picked one shows as selected. */
function SelectionSync({
	selected,
	onSelect,
}: {
	selected?: string;
	onSelect: (key: string) => void;
}) {
	const { setNodes } = useReactFlow();
	const onChange = useCallback(
		({ nodes }: { nodes: { id: string }[] }) => {
			const id = nodes[0]?.id;
			if (id && id !== selected) onSelect(id);
		},
		[onSelect, selected],
	);
	useOnSelectionChange({ onChange });
	useEffect(() => {
		setNodes((all) =>
			all.map((n) =>
				!!n.selected === (n.id === selected) ? n : { ...n, selected: n.id === selected },
			),
		);
	}, [selected, setNodes]);
	return null;
}

/**
 * The diff on the canvas's own read-only view: its blocks and edges, green for
 * added, amber for changed, red for removed. Inline it does not take the scroll
 * wheel (the chat scrolls past it; drag pans); `expanded` is the full-size view,
 * which opens a block's settings on a double click.
 */
export default function CanvasDiffGraph({
	diff,
	selected,
	onSelect,
	expanded = false,
}: {
	diff: CanvasDiff;
	selected?: string;
	onSelect: (key: string) => void;
	expanded?: boolean;
}) {
	const graph = useMemo(() => toGraph(diff), [diff]);
	const statuses = useMemo<Statuses>(
		() => ({
			blocks: new Map(diff.blocks.map((b) => [b.key, b.status])),
			edges: new Map(diff.edges.map((e) => [e.id, e.status])),
		}),
		[diff],
	);
	return (
		<StatusContext.Provider value={statuses}>
			<div
				className={`overflow-hidden rounded-lg border border-border ${expanded ? "h-full" : "h-64"}`}
			>
				<BlockCanvas
					graph={graph}
					mode="readonly"
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					enablePanel={expanded && !diff.partial}
					enableHistory={false}
					enableFormat={false}
					enableClipboard={false}
					enableContextMenu={false}
					enableKeyboard={false}
					showToolbar={false}
					captureScroll={expanded}
				>
					<SelectionSync selected={selected} onSelect={onSelect} />
				</BlockCanvas>
			</div>
		</StatusContext.Provider>
	);
}

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
import { useCanvasPanel } from "@/components/canvas/panel/PanelContext";
import type { BlockEdge } from "@/components/canvas/types";
import type { BlockStatus, CanvasDiff, DiffEdge } from "./canvasDiff";
import { toGraph } from "./diffGraph";
import "./canvasDiff.css";

type Statuses = { blocks: Map<string, BlockStatus>; edges: Map<string, DiffEdge["status"]> };
const StatusContext = createContext<Statuses>({ blocks: new Map(), edges: new Map() });

const blockTypes = createBlockNodeTypes();

/** The canvas's own block for this type, in a wrapper that tints it for what happened to it. */
function DiffBlockNode(props: NodeProps) {
	const status = useContext(StatusContext).blocks.get(props.id) ?? "same";
	const panel = useCanvasPanel();
	const Block = blockTypes[props.type] as ComponentType<NodeProps>;
	return (
		// a click opens the settings (a no-op when the canvas has no panel); the hover menu is slow to appear
		// biome-ignore lint/a11y/useKeyWithClickEvents: the block's own hover menu is the keyboard route
		// biome-ignore lint/a11y/noStaticElementInteractions: same
		<div
			data-block-key={props.id}
			data-status={status}
			className={`fx-diff fx-diff--${status}`}
			onClick={() => panel.open(props.id)}
		>
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
 * added, amber for changed, red for removed. It does not take the scroll wheel
 * (the chat scrolls past it); drag pans.
 */
export default function CanvasDiffGraph({
	diff,
	selected,
	onSelect,
	panel = false,
}: {
	diff: CanvasDiff;
	selected?: string;
	onSelect: (key: string) => void;
	/** The block settings panel, opened from a block's hover menu; the canvas is taller to fit it. */
	panel?: boolean;
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
			<div className={`${panel ? "h-96" : "h-64"} overflow-hidden rounded-lg border border-border`}>
				<BlockCanvas
					graph={graph}
					mode="readonly"
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					enablePanel={panel}
					enableHistory={false}
					enableFormat={false}
					enableClipboard={false}
					enableContextMenu={false}
					enableKeyboard={false}
					showToolbar={false}
					captureScroll={false}
				>
					<SelectionSync selected={selected} onSelect={onSelect} />
				</BlockCanvas>
			</div>
		</StatusContext.Provider>
	);
}

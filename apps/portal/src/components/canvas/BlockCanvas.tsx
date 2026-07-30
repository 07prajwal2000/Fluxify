import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	addEdge,
	Background,
	BackgroundVariant,
	Controls,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	type Connection,
	type EdgeChange,
	type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { flowToGraph, graphToFlow } from "./adapters";
import {
	CanvasChangesProvider,
	cloneChangeSet,
	useChangeTracker,
	type CanvasChanges,
} from "./changes";
import {
	CanvasClipboardProvider,
	useClipboard,
	type GraphPart,
} from "./clipboard";
import { DEFAULT_EDGE_TYPES, FLOW_EDGE_TYPE } from "./edges";
import { uuidv7 } from "./ids";
import {
	CanvasHistoryProvider,
	HistoryControls,
	useCanvasHistory,
	type CanvasSnapshot,
} from "./history";
import { CanvasFormatProvider, FormatControls, layoutBlocks } from "./layout";
import { BlockPanel, CanvasPanelProvider, useBlockPanel } from "./panel";
import type { BlockCanvasProps, BlockEdge, BlockNode } from "./types";

const EMPTY_NODE_TYPES = {};
const DEFAULT_EDGE_OPTIONS = { type: FLOW_EDGE_TYPE };

/**
 * Changes that only affect presentation — not worth reporting as an edit.
 * `dimensions` covers both measuring a node (cosmetic) and a resize gesture; the
 * gesture's closing change carries `resizing: false`, so a resize is recorded
 * once, on release, instead of on every frame.
 */
function isCosmetic(change: NodeChange<BlockNode> | EdgeChange<BlockEdge>) {
	if (change.type === "select") return true;
	return change.type === "dimensions" && change.resizing !== false;
}

/**
 * Identity of a graph's shape: which blocks and edges it holds. Two loads with
 * the same signature are the same graph (a refetch after saving), so recorded
 * undo snapshots still apply to it.
 */
export function graphTopology(nodes: BlockNode[], edges: BlockEdge[]): string {
	const ids = (values: { id: string }[]) =>
		values
			.map((value) => value.id)
			.sort()
			.join(",");
	return `${ids(nodes)}|${ids(edges)}`;
}

/** Feeds a batch of React Flow changes into the change tracker. */
function track(
	tracker: CanvasChanges,
	kind: "blocks" | "edges",
	changes: (NodeChange<BlockNode> | EdgeChange<BlockEdge>)[],
) {
	const upserted: string[] = [];
	const deleted: string[] = [];
	for (const change of changes) {
		if (isCosmetic(change)) continue;
		if (change.type === "remove") deleted.push(change.id);
		else if (change.type === "add" || change.type === "replace")
			upserted.push(change.item.id);
		else upserted.push(change.id);
	}
	if (upserted.length) tracker.markUpserted(kind, upserted);
	if (deleted.length) tracker.markDeleted(kind, deleted);
}

function CanvasInner({
	graph,
	mode = "edit",
	onChange,
	nodeTypes,
	edgeTypes,
	enableHistory = true,
	enableFormat = true,
	enableClipboard = true,
	enablePanel = true,
	fitViewOnInit = true,
	defaultViewport,
	className,
	children,
}: BlockCanvasProps) {
	const readOnly = mode === "readonly";
	const initial = useMemo(() => graphToFlow(graph), [graph]);
	const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(
		initial.nodes,
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState<BlockEdge>(
		initial.edges,
	);

	const tracker = useChangeTracker(!readOnly);

	// Re-hydrate when the caller swaps the graph (e.g. AI produced a new one).
	// Either way the loaded ids become the server-known baseline for tracking.
	const hydrated = useRef(initial);
	const { reset: resetChanges } = tracker;
	useEffect(() => {
		if (hydrated.current !== initial) {
			hydrated.current = initial;
			setNodes(initial.nodes);
			setEdges(initial.edges);
		}
		resetChanges({
			blocks: initial.nodes.map((node) => node.id),
			edges: initial.edges.map((edge) => edge.id),
		});
	}, [initial, setNodes, setEdges, resetChanges]);

	// Report edits after the state has settled, so onChange always sees the
	// graph React Flow actually rendered.
	const pendingEmit = useRef(false);
	useEffect(() => {
		if (!pendingEmit.current) return;
		pendingEmit.current = false;
		onChange?.(flowToGraph(nodes, edges), cloneChangeSet(tracker.changes));
	}, [nodes, edges, onChange, tracker]);

	// Latest graph, readable from history callbacks without re-creating them.
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };

	const getSnapshot = useCallback((): CanvasSnapshot => {
		const positions: CanvasSnapshot["positions"] = {};
		for (const node of latest.current.nodes) positions[node.id] = node.position;
		return { positions, edges: latest.current.edges };
	}, []);

	// Positions are merged back per block so a block's `data` is never rewritten.
	const applySnapshot = useCallback(
		(snapshot: CanvasSnapshot) => {
			pendingEmit.current = true;
			const restored = new Set(snapshot.edges.map((edge) => edge.id));
			tracker.markUpserted("blocks", Object.keys(snapshot.positions));
			tracker.markUpserted("edges", restored);
			tracker.markDeleted(
				"edges",
				latest.current.edges
					.filter((edge) => !restored.has(edge.id))
					.map((edge) => edge.id),
			);
			setNodes((current) =>
				current.map((node) => {
					const position = snapshot.positions[node.id];
					return position ? { ...node, position } : node;
				}),
			);
			setEdges(snapshot.edges);
		},
		[setNodes, setEdges, tracker],
	);

	const history = useCanvasHistory({
		enabled: enableHistory && !readOnly,
		getSnapshot,
		applySnapshot,
	});

	// Only a genuinely different graph invalidates the recorded snapshots. A save
	// refetches the same blocks and edges, and that must not wipe the undo stack —
	// the tracked changes are the only thing a save clears.
	const { clear } = history;
	const topology = useMemo(() => graphTopology(initial.nodes, initial.edges), [initial]);
	useEffect(() => clear(), [topology, clear]);

	// Pasted/duplicated blocks come in already selected, so the originals are
	// deselected to keep a single, draggable selection.
	const insertPart = useCallback(
		(part: GraphPart) => {
			if (readOnly || (part.nodes.length === 0 && part.edges.length === 0)) return;
			history.commit();
			tracker.markUpserted(
				"blocks",
				part.nodes.map((node) => node.id),
			);
			tracker.markUpserted(
				"edges",
				part.edges.map((edge) => edge.id),
			);
			pendingEmit.current = true;
			setNodes((current) => [
				...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
				...part.nodes,
			]);
			setEdges((current) => [
				...current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
				...part.edges,
			]);
		},
		[readOnly, history, tracker, setNodes, setEdges],
	);

	const getGraph = useCallback(() => latest.current, []);
	const clipboard = useClipboard({
		enabled: enableClipboard && !readOnly,
		getGraph,
		insert: insertPart,
	});

	const panel = useBlockPanel(enablePanel);
	// Read from state so the panel follows renames and data edits live.
	const openBlock = useMemo(
		() => nodes.find((node) => node.id === panel.openBlockId) ?? null,
		[nodes, panel.openBlockId],
	);

	const onNodeDoubleClick = useCallback(
		(_: React.MouseEvent, node: BlockNode) => panel.open(node.id),
		[panel],
	);

	const [isFormatting, setIsFormatting] = useState(false);
	const formatEnabled = enableFormat && !readOnly;

	const format = useCallback(async () => {
		if (!formatEnabled) return;
		setIsFormatting(true);
		try {
			const { nodes: current, edges: currentEdges } = latest.current;
			const positions = await layoutBlocks(current, currentEdges);
			if (Object.keys(positions).length === 0) return;
			// Commit only once the layout succeeded, so a failure leaves no entry.
			history.commit();
			applySnapshot({ positions, edges: latest.current.edges });
		} finally {
			setIsFormatting(false);
		}
	}, [formatEnabled, history, applySnapshot]);

	const formatValue = useMemo(
		() => ({ enabled: formatEnabled, format, isFormatting }),
		[formatEnabled, format, isFormatting],
	);

	const handleNodesChange = useCallback(
		(changes: NodeChange<BlockNode>[]) => {
			onNodesChange(changes);
			if (readOnly) return;
			track(tracker, "blocks", changes);
			if (changes.some((c) => !isCosmetic(c))) pendingEmit.current = true;
		},
		[onNodesChange, readOnly, tracker],
	);

	const handleEdgesChange = useCallback(
		(changes: EdgeChange<BlockEdge>[]) => {
			// One commit for the whole batch: a multi-edge delete undoes in one step.
			if (!readOnly && changes.some((c) => c.type === "remove")) history.commit();
			onEdgesChange(changes);
			if (readOnly) return;
			track(tracker, "edges", changes);
			if (changes.some((c) => !isCosmetic(c))) pendingEmit.current = true;
		},
		[onEdgesChange, readOnly, history, tracker],
	);

	// A block feeding itself is the one cycle worth blocking outright: longer
	// cycles are sub-graphs that simply never run unless reached from the
	// entrypoint, so they stay legal.
	const isValidConnection = useCallback(
		(connection: Connection | BlockEdge) => connection.source !== connection.target,
		[],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (readOnly || !isValidConnection(connection)) return;
			// Own the id (uuidv7, what the save endpoint requires) so the new edge can
			// be tracked without diffing state afterwards.
			const edge: BlockEdge = {
				...connection,
				id: uuidv7(),
				type: FLOW_EDGE_TYPE,
			};
			history.commit();
			tracker.markUpserted("edges", [edge.id]);
			pendingEmit.current = true;
			setEdges((current) => addEdge(edge, current));
		},
		[setEdges, readOnly, history, isValidConnection, tracker],
	);

	// Fires once per drag gesture, before anything moves — so a multi-select drag
	// is a single undo entry.
	const onNodeDragStart = useCallback(() => {
		if (!readOnly) history.commit();
	}, [readOnly, history]);

	return (
		<CanvasHistoryProvider history={history}>
			<CanvasChangesProvider value={tracker}>
			<CanvasClipboardProvider value={clipboard}>
			<CanvasFormatProvider value={formatValue}>
			<CanvasPanelProvider value={panel}>
			<div className="fx-canvas-shell">
			<div
				className={[
					"fx-canvas",
					readOnly ? "fx-canvas--readonly" : "",
					className ?? "",
				]
					.filter(Boolean)
					.join(" ")}
			>
				<ReactFlow<BlockNode, BlockEdge>
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes ?? EMPTY_NODE_TYPES}
					edgeTypes={edgeTypes ?? DEFAULT_EDGE_TYPES}
					defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
					onNodesChange={handleNodesChange}
					onEdgesChange={handleEdgesChange}
					onConnect={onConnect}
					isValidConnection={isValidConnection}
					onNodeDragStart={onNodeDragStart}
					onNodeDoubleClick={onNodeDoubleClick}
					nodesDraggable={!readOnly}
					nodesConnectable={!readOnly}
					elementsSelectable={!readOnly}
					deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
					fitView={fitViewOnInit}
					defaultViewport={defaultViewport}
					proOptions={{ hideAttribution: true }}
				>
					<Background
						variant={BackgroundVariant.Dots}
						color="var(--fx-canvas-dot)"
					/>
					<Controls showInteractive={!readOnly}>
						<HistoryControls />
						<FormatControls />
					</Controls>
					{children}
				</ReactFlow>
				{nodes.length === 0 && (
					<div className="fx-canvas__empty">
						{readOnly
							? "Nothing to show."
							: "Empty canvas — add a block to start."}
					</div>
				)}
			</div>
			{panel.enabled && <BlockPanel block={openBlock} onClose={panel.close} />}
			</div>
			</CanvasPanelProvider>
			</CanvasFormatProvider>
			</CanvasClipboardProvider>
			</CanvasChangesProvider>
		</CanvasHistoryProvider>
	);
}

/**
 * Self-contained graph canvas. Renders its own React Flow provider so it can be
 * dropped anywhere (editor page, AI panel, diff view) without extra setup.
 */
export function BlockCanvas(props: BlockCanvasProps) {
	return (
		<ReactFlowProvider>
			<CanvasInner {...props} />
		</ReactFlowProvider>
	);
}

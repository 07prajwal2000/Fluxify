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
import { AiCanvasButton } from "./aiButton";
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
import { findCycleEdgeIds } from "./cycleDetection";
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
	cycleFeedbackToken = 0,
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
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };
	const [flashingCycleEdgeIds, setFlashingCycleEdgeIds] = useState<Set<string>>(
		new Set(),
	);
	const cycleFlashTimeout = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (cycleFeedbackToken === 0) return;
		const cycleEdgeIds = findCycleEdgeIds(
			flowToGraph(latest.current.nodes, latest.current.edges).edges,
		);
		setFlashingCycleEdgeIds(cycleEdgeIds);
		if (cycleFlashTimeout.current) window.clearTimeout(cycleFlashTimeout.current);
		cycleFlashTimeout.current = window.setTimeout(
			() => setFlashingCycleEdgeIds(new Set()),
			1_500,
		);
		return () => {
			if (cycleFlashTimeout.current) window.clearTimeout(cycleFlashTimeout.current);
		};
	}, [cycleFeedbackToken]);

	const renderedEdges = useMemo(() => {
		const cycleEdgeIds = findCycleEdgeIds(flowToGraph(nodes, edges).edges);
		return edges.map((edge) => ({
			...edge,
			data: {
				...edge.data,
				cycle: cycleEdgeIds.has(edge.id),
				cycleFlash: flashingCycleEdgeIds.has(edge.id),
			},
		}));
	}, [nodes, edges, flashingCycleEdgeIds]);

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

	const getSnapshot = useCallback((): CanvasSnapshot => {
		return { nodes: latest.current.nodes, edges: latest.current.edges };
	}, []);

	// Existing blocks keep live config data; restored blocks get saved data.
	const applySnapshot = useCallback(
		(snapshot: CanvasSnapshot) => {
			pendingEmit.current = true;
			const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));
			const currentNodeIds = new Set(
				latest.current.nodes.map((node) => node.id),
			);
			const restored = new Set(snapshot.edges.map((edge) => edge.id));
			tracker.markUpserted("blocks", snapshotNodeIds);
			tracker.markDeleted(
				"blocks",
				[...currentNodeIds].filter((id) => !snapshotNodeIds.has(id)),
			);
			tracker.markUpserted("edges", restored);
			tracker.markDeleted(
				"edges",
				latest.current.edges
					.filter((edge) => !restored.has(edge.id))
					.map((edge) => edge.id),
			);
			setNodes((current) => {
				const byId = new Map(current.map((node) => [node.id, node]));
				return snapshot.nodes.map((node) => {
					const existing = byId.get(node.id);
					return existing ? { ...node, data: existing.data } : node;
				});
			});
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
			applySnapshot({
				nodes: current.map((node) => ({
					...node,
					position: positions[node.id] ?? node.position,
				})),
				edges: latest.current.edges,
			});
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
			onEdgesChange(changes);
			if (readOnly) return;
			track(tracker, "edges", changes);
			if (changes.some((c) => !isCosmetic(c))) pendingEmit.current = true;
		},
		[onEdgesChange, readOnly, tracker],
	);

	const onBeforeDelete = useCallback(async () => {
		if (!readOnly) history.commit();
		return true;
	}, [readOnly, history]);

	// Cycles are shown immediately and rejected on save. Connections remain
	// creatable so users can see and remove the entire invalid path.
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
					edges={renderedEdges}
					nodeTypes={nodeTypes ?? EMPTY_NODE_TYPES}
					edgeTypes={edgeTypes ?? DEFAULT_EDGE_TYPES}
					defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
					onNodesChange={handleNodesChange}
					onEdgesChange={handleEdgesChange}
					onConnect={onConnect}
					onBeforeDelete={onBeforeDelete}
					isValidConnection={isValidConnection}
					onNodeDragStart={onNodeDragStart}
					onNodeDoubleClick={onNodeDoubleClick}
					nodesDraggable={!readOnly}
					nodesConnectable={!readOnly}
					elementsSelectable={true}
					deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
					fitView={fitViewOnInit}
					defaultViewport={defaultViewport}
					proOptions={{ hideAttribution: true }}
				>
					<Background
						variant={BackgroundVariant.Dots}
						color="var(--fx-canvas-dot)"
					/>
					{/* React Flow's Controls has no icon props; its buttons are styled in canvas.css */}
					<Controls showInteractive={!readOnly}>
						<HistoryControls />
						<FormatControls />
					</Controls>
					{children}
				</ReactFlow>
				{/* the AI edits the graph — nothing to offer on a readonly view */}
				{!readOnly && <AiCanvasButton />}
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

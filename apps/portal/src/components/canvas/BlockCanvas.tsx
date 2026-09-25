import {
	addEdge,
	Background,
	BackgroundVariant,
	type Connection,
	type EdgeChange,
	type NodeChange,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { toast } from "@fluxify/components";
import { flowToGraph, graphToFlow } from "./adapters";
import { AiCanvasButton } from "./aiButton";
import { BlockPickerSidebar } from "./BlockPickerSidebar";
import { BLOCK_TYPES } from "./blocks";
import { CanvasCommands } from "./CanvasCommands";
import { CanvasLayoutLockProvider } from "./CanvasLayoutLockContext";
import { CanvasQuickActions } from "./CanvasQuickActions";
import { CanvasToolbar } from "./CanvasToolbar";
import {
	type CanvasChanges,
	CanvasChangesProvider,
	cloneChangeSet,
	useChangeTracker,
} from "./changes";
import { CanvasClipboardProvider, type GraphPart, useClipboard } from "./clipboard";
import { useContextMenu } from "./contextMenu";
import {
	CanvasDiagnosticsProvider,
	DiagnosticsPanel,
	useCanvasDiagnosticsBridge,
	useHasDiagnosticsProvider,
} from "./diagnostics";
import { DEFAULT_EDGE_TYPES, FLOW_EDGE_TYPE } from "./edges";
import { EdgeHoverProvider } from "./edges/edgeHover";
import { CanvasHistoryProvider, type CanvasSnapshot, useCanvasHistory } from "./history";
import { uuidv7 } from "./ids";
import { KeyboardShortcutsProvider } from "./keyboard";
import { CanvasFormatProvider, layoutBlocks } from "./layout";
import { CanvasPlaygroundProvider, useCanvasPlayground } from "./PlaygroundContext";
import { PlaygroundModal } from "./PlaygroundModal";
import { BlockPanel, CanvasPanelProvider, useBlockPanel } from "./panel";
import { CanvasVariableSnippets } from "./panel/SaveOutputField";
import { QuickAddProvider } from "./QuickAddContext";
import { applyQuickAdd, canInsertIntoEdge, type QuickAddContext, quickAdd } from "./quickAdd";
import { graphTopology, isCosmetic, track } from "./topology";
import type { BlockCanvasProps, BlockEdge, BlockNode } from "./types";
import { useAddBlock } from "./useAddBlock";
import { useBlockPicker } from "./useBlockPicker";
import { useApplyQuickAdd, useConnectToPicker } from "./useConnectToPicker";
import { useCycleFlash } from "./useCycleFlash";

export { graphTopology };

const EMPTY_NODE_TYPES = {};
const DEFAULT_EDGE_OPTIONS = { type: FLOW_EDGE_TYPE };
function CanvasInner({
	graph,
	mode = "edit",
	onChange,
	nodeTypes,
	edgeTypes,
	enableHistory = true,
	enableFormat = true,
	enableClipboard = true,
	enableContextMenu = true,
	enableKeyboard = true,
	onSave,
	enablePanel = true,
	enableBlockPicker = false,
	enablePlayground = false,
	enableSpotlight = false,
	playgroundContent,
	fitViewOnInit = true,
	defaultViewport,
	className,
	cycleFeedbackToken = 0,
	children,
}: BlockCanvasProps) {
	const readOnly = mode === "readonly";
	const initial = useMemo(() => graphToFlow(graph), [graph]);
	const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(initial.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState<BlockEdge>(initial.edges);
	const blockPicker = useBlockPicker();
	const playground = useCanvasPlayground();
	const canvasRef = useRef<HTMLDivElement>(null);
	// The panel sits beside the canvas, not in it — shortcuts must reach both.
	const shellRef = useRef<HTMLDivElement>(null);
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };
	const renderedEdges = useCycleFlash(nodes, edges, cycleFeedbackToken);

	const tracker = useChangeTracker(!readOnly);

	const { reset: resetChanges } = tracker;

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
			const currentNodeIds = new Set(latest.current.nodes.map((node) => node.id));
			const restored = new Set(snapshot.edges.map((edge) => edge.id));
			tracker.markUpserted("blocks", snapshotNodeIds);
			tracker.markDeleted(
				"blocks",
				[...currentNodeIds].filter((id) => !snapshotNodeIds.has(id)),
			);
			tracker.markUpserted("edges", restored);
			tracker.markDeleted(
				"edges",
				latest.current.edges.filter((edge) => !restored.has(edge.id)).map((edge) => edge.id),
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

	// Re-hydrate when the caller swaps the graph (e.g. AI produced a new one, or
	// another route was opened) — and only then.
	//
	// A save refetches the graph, which hands us a brand new object holding
	// exactly what is already on screen, blocks we just added included. Reacting
	// to that would replace live state and wipe the undo stack every time the
	// user saves, so the incoming graph is compared against what the canvas
	// currently shows rather than against the previously loaded object.
	//
	// Either way the loaded ids become the server-known baseline for tracking.
	const hydrated = useRef(initial);
	const { clear } = history;
	useEffect(() => {
		if (hydrated.current !== initial) {
			hydrated.current = initial;
			const incoming = graphTopology(initial.nodes, initial.edges);
			const onScreen = graphTopology(latest.current.nodes, latest.current.edges);
			if (incoming !== onScreen) {
				setNodes(initial.nodes);
				setEdges(initial.edges);
				// Snapshots describe a graph that is no longer on the canvas.
				clear();
			}
		}
		resetChanges({
			blocks: initial.nodes.map((node) => node.id),
			edges: initial.edges.map((edge) => edge.id),
		});
	}, [initial, setNodes, setEdges, resetChanges, clear]);

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
	const { diagnostics, wrappedPanel, handleSelectBlock } = useCanvasDiagnosticsBridge({
		nodes,
		edges,
		setNodes,
		panel,
	});

	// Read from state so the panel follows renames and data edits live.
	const openBlock = useMemo(
		() => nodes.find((node) => node.id === panel.openBlockId) ?? null,
		[nodes, panel.openBlockId],
	);

	const onNodeDoubleClick = useCallback(
		(_: React.MouseEvent, node: BlockNode) => wrappedPanel.open(node.id),
		[wrappedPanel],
	);

	const contextMenu = useContextMenu(enableContextMenu && !readOnly);

	// Right-clicking a block acts on that block: an unselected one becomes the
	// selection, an already-selected one keeps the whole multi-selection intact.
	const onNodeContextMenu = useCallback(
		(_: React.MouseEvent, node: BlockNode) => {
			setNodes((current) =>
				current.some((item) => item.id === node.id && item.selected)
					? current
					: current.map((item) => ({ ...item, selected: item.id === node.id })),
			);
		},
		[setNodes],
	);

	const [isFormatting, setIsFormatting] = useState(false);
	const [layoutLocked, setLayoutLocked] = useState(false);
	const formatEnabled = enableFormat && !readOnly && !layoutLocked;

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
	const canEditLayout = !readOnly && !layoutLocked;

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

	const onBeforeDelete = useCallback(
		async ({
			nodes: deletingNodes,
			edges: deletingEdges,
		}: {
			nodes: BlockNode[];
			edges: BlockEdge[];
		}) => {
			const protectedNodeIds = new Set(
				deletingNodes
					.filter(
						(node) =>
							node.type === BLOCK_TYPES.entrypoint || node.type === BLOCK_TYPES.errorHandler,
					)
					.map((node) => node.id),
			);
			const nodes = deletingNodes.filter((node) => !protectedNodeIds.has(node.id));
			const edges = deletingEdges.filter(
				(edge) => !protectedNodeIds.has(edge.source) && !protectedNodeIds.has(edge.target),
			);

			// Reject protected nodes even when they are part of a keyboard or bulk
			// delete. Returning the remaining candidates lets React Flow delete only
			// the allowed elements.
			if (protectedNodeIds.size > 0) {
				toast.danger("Entrypoint and error handler blocks cannot be deleted.");
			}
			if (nodes.length === 0 && edges.length === 0) return false;
			if (!readOnly) history.commit();
			return { nodes, edges };
		},
		[readOnly, history],
	);

	// Cycles are shown immediately and rejected on save. Connections remain
	// creatable so users can see and remove the entire invalid path.
	const isValidConnection = useCallback(
		(connection: Connection | BlockEdge) => connection.source !== connection.target,
		[],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!canEditLayout || !isValidConnection(connection)) return;
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
		[setEdges, canEditLayout, history, isValidConnection, tracker],
	);

	// Fires once per drag gesture, before anything moves — so a multi-select drag
	// is a single undo entry.
	const onNodeDragStart = useCallback(() => {
		if (!readOnly) history.commit();
	}, [readOnly, history]);

	const onQuickAdd = useApplyQuickAdd({
		latest,
		pendingEmit,
		history,
		tracker,
		setNodes,
		setEdges,
	});

	// `at` is a viewport point (a right-click), not a graph position — the block
	// appears under the pointer at whatever zoom and pan is in effect.
	const { addBlock, openPickerAt, addPickedBlock, openPickerFor, pending } = useAddBlock({
		readOnly,
		canvasRef,
		openPicker: blockPicker.open,
		onQuickAdd,
		onBeforeAdd: (blockId) => {
			history.commit();
			tracker.markUpserted("blocks", [blockId]);
			pendingEmit.current = true;
		},
		addNode: (node) =>
			setNodes((current) => [
				...current.map((item) => (item.selected ? { ...item, selected: false } : item)),
				node,
			]),
	});

	const quickAddEnabled = enableBlockPicker && canEditLayout;
	const { onConnectStart, onConnectEnd } = useConnectToPicker({
		enabled: quickAddEnabled,
		getEdges: () => latest.current.edges,
		openPickerFor,
	});

	return (
		<CanvasHistoryProvider history={history}>
			<CanvasChangesProvider value={tracker}>
				<CanvasClipboardProvider value={clipboard}>
					<CanvasFormatProvider value={formatValue}>
						<CanvasLayoutLockProvider locked={layoutLocked}>
							<CanvasPanelProvider value={wrappedPanel}>
								<QuickAddProvider value={quickAddEnabled ? openPickerFor : null}>
									<EdgeHoverProvider rootRef={canvasRef}>
										<div className="fx-canvas-shell" ref={shellRef}>
											<CanvasCommands
												readOnly={readOnly}
												enableKeyboard={enableKeyboard && !readOnly}
												menu={contextMenu}
												rootRef={shellRef}
												onSave={onSave}
												onAddBlock={enableBlockPicker && !layoutLocked ? openPickerAt : undefined}
												onAddNote={
													enableBlockPicker && !layoutLocked
														? (at) => addBlock(BLOCK_TYPES.stickynote, at)
														: undefined
												}
												enableSpotlight={enableSpotlight && !readOnly}
												onAddBlockType={
													!readOnly && !layoutLocked ? (type) => addBlock(type) : undefined
												}
												enablePlayground={enablePlayground}
												onOpenPlayground={playground.open}
											/>
											<div
												ref={canvasRef}
												onContextMenu={contextMenu.openAt}
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
													onConnectStart={onConnectStart}
													onConnectEnd={onConnectEnd}
													// A handle click opens the picker (its `+`), not click-to-connect.
													connectOnClick={!quickAddEnabled}
													onBeforeDelete={onBeforeDelete}
													isValidConnection={isValidConnection}
													onNodeDragStart={onNodeDragStart}
													onNodeDoubleClick={onNodeDoubleClick}
													onNodeContextMenu={onNodeContextMenu}
													nodesDraggable={canEditLayout}
													nodesConnectable={canEditLayout}
													elementsSelectable={true}
													deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
													elevateNodesOnSelect={false}
													zIndexMode="manual"
													fitView={fitViewOnInit}
													defaultViewport={defaultViewport}
													proOptions={{ hideAttribution: true }}
												>
													<Background
														variant={BackgroundVariant.Dots}
														color="var(--fx-canvas-dot)"
													/>
													<CanvasToolbar
														readOnly={readOnly}
														layoutLocked={layoutLocked}
														onToggleLayoutLock={() => setLayoutLocked((locked) => !locked)}
													/>
													{children}
												</ReactFlow>
												{/* the AI edits the graph — nothing to offer on a readonly view */}
												{!readOnly && <AiCanvasButton />}
												{!readOnly && !layoutLocked && (
													<CanvasQuickActions
														enableBlockPicker={enableBlockPicker}
														enablePlayground={enablePlayground}
														onOpenBlockPicker={() => openPickerAt()}
														onAddNote={() => addBlock(BLOCK_TYPES.stickynote)}
														onOpenPlayground={playground.open}
													/>
												)}
												{nodes.length === 0 && (
													<div className="fx-canvas__empty">
														{readOnly ? "Nothing to show." : "Empty canvas — add a block to start."}
													</div>
												)}
											</div>
											{!readOnly && !layoutLocked && enableBlockPicker && (
												<BlockPickerSidebar
													isOpen={blockPicker.isOpen}
													onOpenChange={blockPicker.onOpenChange}
													onAdd={addPickedBlock}
													filter={pending?.kind === "edge" ? canInsertIntoEdge : undefined}
													filterReason="Needs an input and an output to sit inside a connection."
												/>
											)}
											{panel.enabled && (
												<BlockPanel
													block={openBlock}
													initialTab={panel.initialTab}
													openSeq={panel.openSeq}
													onClose={panel.close}
												/>
											)}
											<DiagnosticsPanel
												isOpen={diagnostics.isPanelOpen}
												onClose={diagnostics.closePanel}
												onSelectBlock={handleSelectBlock}
											/>
											{enablePlayground && playgroundContent && (
												<PlaygroundModal>{playgroundContent}</PlaygroundModal>
											)}
										</div>
									</EdgeHoverProvider>
								</QuickAddProvider>
							</CanvasPanelProvider>
						</CanvasLayoutLockProvider>
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
	const hasProvider = useHasDiagnosticsProvider();
	const content = (
		<ReactFlowProvider>
			<CanvasVariableSnippets />
			<CanvasPlaygroundProvider>
				<KeyboardShortcutsProvider>
					<CanvasInner {...props} />
				</KeyboardShortcutsProvider>
			</CanvasPlaygroundProvider>
		</ReactFlowProvider>
	);

	if (hasProvider) {
		return content;
	}
	return <CanvasDiagnosticsProvider>{content}</CanvasDiagnosticsProvider>;
}

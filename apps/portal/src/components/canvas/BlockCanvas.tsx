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
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { flowToGraph, graphToFlow } from "./adapters";
import { AiCanvasButton } from "./aiButton";
import { BLOCK_TYPES } from "./blocks";
import { CanvasCommands } from "./CanvasCommands";
import { CanvasLayoutLockProvider } from "./CanvasLayoutLockContext";
import { CanvasOverlays } from "./CanvasOverlays";
import { CanvasQuickActions } from "./CanvasQuickActions";
import { CanvasReadOnlyProvider } from "./CanvasReadOnlyContext";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasChangesProvider, cloneChangeSet, useChangeTracker } from "./changes";
import { CanvasClipboardProvider, type GraphPart, useClipboard } from "./clipboard";
import { useContextMenu } from "./contextMenu";
import {
	CanvasDiagnosticsProvider,
	useCanvasDiagnosticsBridge,
	useHasDiagnosticsProvider,
} from "./diagnostics";
import { DEFAULT_EDGE_TYPES, FLOW_EDGE_TYPE } from "./edges";
import { EdgeHoverProvider } from "./edges/edgeHover";
import { CanvasHistoryProvider, useCanvasHistory } from "./history";
import { uuidv7 } from "./ids";
import { KeyboardShortcutsProvider } from "./keyboard";
import { CanvasFormatProvider } from "./layout";
import { CanvasPlaygroundProvider, useCanvasPlayground } from "./PlaygroundContext";
import { CanvasPanelProvider, useBlockPanel } from "./panel";
import { CanvasVariableSnippets } from "./panel/SaveOutputField";
import { QuickAddProvider } from "./QuickAddContext";
import { graphTopology, isCosmetic, track } from "./topology";
import type { BlockCanvasProps, BlockEdge, BlockNode } from "./types";
import { useAddBlock } from "./useAddBlock";
import { useBlockCanvasDelete } from "./useBlockCanvasDelete";
import { useBlockPicker } from "./useBlockPicker";
import { useCanvasFormatValue } from "./useCanvasFormatValue";
import { useCanvasSnapshots } from "./useCanvasSnapshots";
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
	trackExecutionContent,
	fitViewOnInit = true,
	defaultViewport,
	className,
	cycleFeedbackToken = 0,
	reloadToken = 0,
	onNodeDoubleClick: onCustomNodeDoubleClick,
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

	const { getSnapshot, applySnapshot } = useCanvasSnapshots({
		latest,
		tracker,
		pendingEmit,
		setNodes,
		setEdges,
	});

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

	// A reload after a change made elsewhere (#597) may keep every id while
	// changing block data, so it replaces the canvas whatever the topology says.
	const reloaded = useRef(reloadToken);
	useEffect(() => {
		if (reloaded.current === reloadToken) return;
		reloaded.current = reloadToken;
		setNodes(initial.nodes);
		setEdges(initial.edges);
		clear();
		resetChanges({
			blocks: initial.nodes.map((node) => node.id),
			edges: initial.edges.map((edge) => edge.id),
		});
	}, [reloadToken, initial, setNodes, setEdges, resetChanges, clear]);

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
		(event: React.MouseEvent, node: BlockNode) => {
			if (onCustomNodeDoubleClick) {
				onCustomNodeDoubleClick(event, node);
				return;
			}
			wrappedPanel.open(node.id);
		},
		[wrappedPanel, onCustomNodeDoubleClick],
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

	const [layoutLocked, setLayoutLocked] = useState(false);
	const formatValue = useCanvasFormatValue({
		enableFormat,
		readOnly,
		layoutLocked,
		latest,
		history,
		applySnapshot,
	});
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

	const onBeforeDelete = useBlockCanvasDelete({ readOnly, history });

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
							<CanvasReadOnlyProvider readOnly={readOnly}>
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
												{/* biome-ignore lint/a11y/noStaticElementInteractions: canvas right-click context menu */}
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
															{readOnly
																? "Nothing to show."
																: "Empty canvas — add a block to start."}
														</div>
													)}
												</div>
												<CanvasOverlays
													readOnly={readOnly}
													layoutLocked={layoutLocked}
													enableBlockPicker={enableBlockPicker}
													blockPicker={blockPicker}
													addPickedBlock={addPickedBlock}
													pending={pending}
													panel={panel}
													openBlock={openBlock}
													diagnostics={diagnostics}
													handleSelectBlock={handleSelectBlock}
													enablePlayground={enablePlayground}
													playgroundContent={playgroundContent}
													trackExecutionContent={trackExecutionContent}
												/>
											</div>
										</EdgeHoverProvider>
									</QuickAddProvider>
								</CanvasPanelProvider>
							</CanvasReadOnlyProvider>
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

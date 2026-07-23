"use client";
import { BlockTypes, type BaseBlockType, type EdgeType } from "@/types/block";
import {
	applyEdgeChanges,
	applyNodeChanges,
	type EdgeChange,
	type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import ELK from "elkjs/lib/elk.bundled.js";

type State = {
	blocks: BaseBlockType[];
	edges: EdgeType[];
};

type Actions = {
	actions: {
		blocks: {
			addBlock: (block: BaseBlockType) => void;
			deleteBlock: (id: string) => void;
			onBlockChange: (changes: NodeChange[]) => void;
			formatBlocks(): Promise<string[]>;
			deleteBulk(ids: Set<string>): void;
			setSelection(ids: string[], value: boolean): void;
		};
		edges: {
			addEdge: (edge: EdgeType) => void;
			deleteEdge: (id: string) => void;
			onEdgeChange: (changes: Partial<EdgeChange>[]) => void;
			deleteBulk(ids: Set<string>): void;
			setSelection(ids: string[], value: boolean): void;
		};
		bulkInsert(blocks: BaseBlockType[], edges: EdgeType[]): void;
	};
};

import React, { createContext, useContext, useRef } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
// ... imports

export type CanvasStore = ReturnType<typeof createCanvasStore>;

export const createCanvasStore = (initProps?: Partial<State>) => {
	return createStore<State & Actions>()((set, get) => ({
		blocks: initProps?.blocks || [],
		edges: initProps?.edges || [],
		actions: {
			blocks: {
				async formatBlocks() {
					const blocksToFormat = get().blocks.filter(
						(block) => block.type !== BlockTypes.stickynote,
					);
					const stickyNoteBlocks = get().blocks.filter(
						(block) => block.type === BlockTypes.stickynote,
					);

					const elk = new ELK();

					const getPortSide = (handleId: string) => {
						if (handleId.endsWith("-target")) return "NORTH";
						if (handleId.endsWith("-source")) return "SOUTH";
						if (handleId.endsWith("-success")) return "WEST";
						if (handleId.endsWith("-failure")) return "EAST";
						if (handleId.endsWith("-executor")) return "EAST";
						return "SOUTH";
					};

					const portsMap = new Map<string, Set<string>>();
					get().edges.forEach((edge) => {
						if (edge.sourceHandle) {
							if (!portsMap.has(edge.source))
								portsMap.set(edge.source, new Set());
							portsMap.get(edge.source)!.add(edge.sourceHandle);
						}
						if (edge.targetHandle) {
							if (!portsMap.has(edge.target))
								portsMap.set(edge.target, new Set());
							portsMap.get(edge.target)!.add(edge.targetHandle);
						}
					});

					const graph = {
						id: "root",
						layoutOptions: {
							"elk.algorithm": "layered",
							"elk.direction": "DOWN",
							"elk.spacing.nodeNode": "15",
							"elk.layered.spacing.nodeNodeBetweenLayers": "15",
							"elk.spacing.edgeNode": "15",
							"elk.spacing.edgeEdge": "15",
							"elk.edgeRouting": "POLYLINE",
						},
						children: blocksToFormat.map((block) => {
							const nodePorts = Array.from(portsMap.get(block.id) || []);
							return {
								id: block.id,
								width: 75,
								height: 75,
								layoutOptions: {
									"elk.portConstraints": "FIXED_SIDE",
								},
								ports: nodePorts.map((portId) => ({
									id: portId,
									properties: { "port.side": getPortSide(portId) },
								})),
							};
						}),
						edges: get().edges.map((edge) => ({
							id: edge.id,
							sources: [edge.sourceHandle || edge.source],
							targets: [edge.targetHandle || edge.target],
						})),
					};

					const layoutedGraph = await elk.layout(graph as any);

					const blocks = blocksToFormat.map((block) => {
						const node = layoutedGraph.children?.find((n) => n.id === block.id);
						return {
							...block,
							position: {
								x: node?.x ?? block.position.x,
								y: node?.y ?? block.position.y,
							},
						};
					});

					const finalBlocks = blocks.concat(stickyNoteBlocks);
					set({ blocks: finalBlocks });
					return blocksToFormat.map((b) => b.id);
				},
				addBlock(block) {
					set({ blocks: [...get().blocks, block] });
				},
				deleteBlock(id) {
					set({
						blocks: get().blocks.filter((b) => {
							const isEntrypoint = b.type === BlockTypes.entrypoint;
							if (isEntrypoint) {
								return true;
							}
							return b.id !== id;
						}),
						edges: get().edges.filter((e) => e.source !== id && e.target !== id),
					});
				},
				setSelection(ids: string[], value: boolean) {
					const idSet = new Set(ids);
					set({
						blocks: get().blocks.map((b) => {
							const valueToSet = idSet.has(b.id) ? value : !value;
							return { ...b, selected: valueToSet };
						}),
					});
				},
				deleteBulk(ids: Set<string>) {
					set({
						blocks: get().blocks.filter((b) => {
							const isEntrypoint = b.type === BlockTypes.entrypoint;
							if (isEntrypoint) {
								return true;
							}
							return !ids.has(b.id);
						}),
						edges: get().edges.filter(
							(e) => !ids.has(e.source) && !ids.has(e.target),
						),
					});
				},
				onBlockChange(changes) {
					set({
						blocks: applyNodeChanges(
							changes,
							get().blocks as any,
						) as BaseBlockType[],
					});
				},
			},
			edges: {
				addEdge(edge) {
					set({ edges: [...get().edges, edge] });
				},
				deleteBulk(ids: Set<string>) {
					set({ edges: get().edges.filter((e) => !ids.has(e.id)) });
				},
				deleteEdge(id) {
					set({ edges: get().edges.filter((e) => e.id !== id) });
				},
				onEdgeChange(changes) {
					set({ edges: applyEdgeChanges(changes as any, get().edges) });
				},
				setSelection(ids: string[], value: boolean) {
					const idSet = new Set(ids);
					set({
						edges: get().edges.map((e) => {
							const valueToSet = idSet.has(e.id) ? value : !value;
							return { ...e, selected: valueToSet };
						}),
					});
				},
			},
			bulkInsert(blocks, edges) {
				set({ blocks: [...blocks] });
				set({ edges: [...edges] });
			},
		},
	}));
};

export const CanvasStoreContext = createContext<CanvasStore | null>(null);

export function CanvasStoreProvider({
	children,
	initialBlocks,
	initialEdges,
}: React.PropsWithChildren<{
	initialBlocks?: BaseBlockType[];
	initialEdges?: EdgeType[];
}>) {
	const storeRef = useRef<CanvasStore | null>(null);
	if (!storeRef.current) {
		storeRef.current = createCanvasStore({
			blocks: initialBlocks,
			edges: initialEdges,
		});
	}
	return (
		<CanvasStoreContext.Provider value={storeRef.current}>
			{children}
		</CanvasStoreContext.Provider>
	);
}

export function useCanvasStore<T>(selector: (state: State & Actions) => T): T {
	const store = useContext(CanvasStoreContext);
	if (!store) throw new Error("Missing CanvasStoreProvider");
	return useStore(store, selector);
}

export const useCanvasActionsStore = () =>
	useCanvasStore((state) => state.actions);
export const useCanvasBlocksStore = () =>
	useCanvasStore((state) => state.blocks);
export const useCanvasEdgesStore = () => useCanvasStore((state) => state.edges);

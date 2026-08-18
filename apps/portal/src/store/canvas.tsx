"use client";
import { BlockTypes, type BaseBlockType, type EdgeType } from "@/types/block";
import {
	applyEdgeChanges,
	applyNodeChanges,
	type EdgeChange,
	type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { layoutGraph } from "@fluxify/blocks/layout";

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

					// Same layout the harness runs at apply time, so a formatted
					// canvas looks identical whoever built it.
					const positions = layoutGraph(
						blocksToFormat.map((block) => ({
							id: block.id,
							type: block.type,
							position: block.position,
						})),
						get().edges.map((edge) => ({
							id: edge.id,
							from: edge.source,
							to: edge.target,
							fromHandle: edge.sourceHandle ?? undefined,
							toHandle: edge.targetHandle ?? undefined,
						})),
					);

					const blocks = blocksToFormat.map((block) => ({
						...block,
						position: positions[block.id] ?? block.position,
					}));

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

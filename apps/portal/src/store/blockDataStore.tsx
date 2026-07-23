"use client";
import React, { createContext, useContext, useRef } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

type State = {
  blockData: Record<string, any>;
};

type Actions = {
  updateBlockData: (id: string, data: any) => void;
  deleteBlockData: (id: string) => void;
  clearBlockData: () => void;
  bulkInsert: (blocks: { id: string; data: any }[]) => void;
};

export type BlockDataStore = ReturnType<typeof createBlockDataStore>;

export const createBlockDataStore = (initProps?: Partial<State>) => {
  return createStore<State & { actions: Actions }>()((set, get) => ({
    blockData: initProps?.blockData || {},
    actions: {
      updateBlockData(id, data) {
        set((state) => ({
          blockData: {
            ...state.blockData,
            [id]: { ...state.blockData[id], ...data }
          }
        }));
      },
      deleteBlockData(id) {
        set((state) => {
          const newBlockData = { ...state.blockData };
          delete newBlockData[id];
          return { blockData: newBlockData };
        });
      },
      clearBlockData() {
        set({ blockData: {} });
      },
      bulkInsert(blocks) {
        const newBlockData = blocks.reduce((acc, block) => {
          acc[block.id] = block.data;
          return acc;
        }, {} as Record<string, any>);
        
        set({ blockData: newBlockData });
      },
    },
  }));
};

export const BlockDataStoreContext = createContext<BlockDataStore | null>(null);

export function BlockDataStoreProvider({
	children,
	initialBlockData,
}: React.PropsWithChildren<{
	initialBlockData?: Record<string, any>;
}>) {
	const storeRef = useRef<BlockDataStore | null>(null);
	if (!storeRef.current) {
		storeRef.current = createBlockDataStore({
			blockData: initialBlockData,
		});
	}
	return (
		<BlockDataStoreContext.Provider value={storeRef.current}>
			{children}
		</BlockDataStoreContext.Provider>
	);
}

export function useBlockDataStoreObj<T>(selector: (state: State & { actions: Actions }) => T): T {
	const store = useContext(BlockDataStoreContext);
	if (!store) throw new Error("Missing BlockDataStoreProvider");
	return useStore(store, selector);
}

export const useBlockDataStore = () =>
  useBlockDataStoreObj((state) => state.blockData);

export const useBlockDataActionsStore = () =>
  useBlockDataStoreObj((state) => state.actions);

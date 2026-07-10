"use client";
import { BaseBlockType, EdgeType } from "@/types/block";
import { enableMapSet, produce } from "immer";
import React, { createContext, useContext, useRef } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
	type Actions,
	type EditorActionStateType,
	EditorTab,
	type State,
} from "./editorTypes";

export { EditorTab };
export type { EditorActionStateType };

enableMapSet();

const STACK_SIZE = 20;

export type EditorStore = ReturnType<typeof createEditorStore>;

export const createEditorStore = () => {
	return createStore<State & Actions>()(
		immer((set, get) => ({
			blockSettings: {
				opened: false,
				blockId: "",
				open(id) {
					set((state) => {
						state.blockSettings.opened = true;
						state.blockSettings.blockId = id;
					});
				},
				close() {
					set((state) => {
						state.blockSettings.opened = false;
						state.blockSettings.blockId = "";
					});
				},
				setBlockId(id) {
					set((state) => {
						state.blockSettings.blockId = id;
					});
				},
			},
			tabs: {
				activeTab: EditorTab.EDITOR,
				setEditorTab(tab) {
					set((state) => {
						state.tabs.activeTab = tab;
					});
				},
			},
			searchbar: {
				opened: false,
				searchQuery: "",
				currentIndex: 0,
				open() {
					set((state) => {
						state.searchbar.opened = true;
					});
				},
				incrementIndex(max) {
					max--;
					set((state) => {
						state.searchbar.currentIndex +=
							state.searchbar.currentIndex < max ? 1 : 0;
					});
				},
				decrementIndex() {
					set((state) => {
						state.searchbar.currentIndex +=
							state.searchbar.currentIndex > 0 ? -1 : 0;
					});
				},
				setSearchQuery(query) {
					set((state) => {
						state.searchbar.searchQuery = query;
					});
				},
				close() {
					set((state) => {
						state.searchbar.opened = false;
						state.searchbar.searchQuery = "";
						state.searchbar.currentIndex = 0;
					});
				},
				setCurrentIndex(index) {
					set((state) => {
						state.searchbar.currentIndex = index;
					});
				},
			},
			aiWindow: {
				opened: false,
				toggle() {
					set((state) => {
						state.aiWindow.opened = !state.aiWindow.opened;
					});
				},
			},
			actions: {
				undoStack: [],
				redoStack: [],
				disableRecording: false,
				record(action) {
					if (get().actions.disableRecording) return;
					set((state) => {
						state.actions = produce(state.actions, (draft) => {
							draft.redoStack = [];
							draft.undoStack.push(action);
						});
					});
				},
				undo(currentSnapshot: EditorActionStateType) {
					if (get().actions.undoStack.length === 0) return;
					let copiedData: EditorActionStateType | undefined;
					set((state) => {
						state.actions = produce(state.actions, (draft) => {
							const item = draft.undoStack.pop()!;
							copiedData = JSON.parse(JSON.stringify(item));

							draft.redoStack.push(currentSnapshot);
							if (draft.redoStack.length > STACK_SIZE) {
								draft.redoStack.shift();
							}
						});
					});
					return copiedData;
				},
				redo(currentSnapshot: EditorActionStateType) {
					if (get().actions.redoStack.length === 0) return;
					let copiedData: EditorActionStateType | undefined;
					set((state) => {
						state.actions = produce(state.actions, (draft) => {
							const item = draft.redoStack.pop()!;
							copiedData = JSON.parse(JSON.stringify(item));

							draft.undoStack.push(currentSnapshot);
							if (draft.undoStack.length > STACK_SIZE) {
								draft.undoStack.shift();
							}
						});
					});
					return copiedData;
				},
				enable() {
					set((state) => {
						state.actions.disableRecording = false;
					});
				},
				disable() {
					set((state) => {
						state.actions.disableRecording = true;
					});
				},
				reset() {
					set((state) => {
						state.actions.undoStack = [];
						state.actions.redoStack = [];
					});
				},
			},
			changeTracker: {
				tracker: new Map(),
				add(id, type) {
					set((state) => {
						state.changeTracker.tracker = produce(
							state.changeTracker.tracker,
							(draft) => {
								draft.set(id, type);
							},
						);
					});
				},
				remove(id) {
					set((state) => {
						state.changeTracker.tracker = produce(
							state.changeTracker.tracker,
							(draft) => {
								draft.delete(id);
							},
						);
					});
				},
				reset() {
					set((state) => {
						state.changeTracker = produce(state.changeTracker, (draft) => {
							draft.tracker = new Map();
						});
					});
				},
			},
			reset() {
				set((state) => {
					state.tabs.activeTab = EditorTab.EDITOR;
					state.searchbar.opened = false;
					state.aiWindow.opened = false;
					state.searchbar.searchQuery = "";
					state.actions.reset();
					state.changeTracker.reset();
				});
			},
		})),
	);
};

export const EditorStoreContext = createContext<EditorStore | null>(null);

export function EditorStoreProvider({
	children,
}: React.PropsWithChildren<{}>) {
	const storeRef = useRef<EditorStore | null>(null);
	if (!storeRef.current) {
		storeRef.current = createEditorStore();
	}
	return (
		<EditorStoreContext.Provider value={storeRef.current}>
			{children}
		</EditorStoreContext.Provider>
	);
}

export function useEditorStoreObj<T>(selector: (state: State & Actions) => T): T {
	const store = useContext(EditorStoreContext);
	if (!store) throw new Error("Missing EditorStoreProvider");
	return useStore(store, selector);
}

export const useEditorStore = useEditorStoreObj;

export function useEditorTabStore() {
	return useEditorStoreObj((state) => state.tabs);
}

export function useEditorSearchbarStore() {
	return useEditorStoreObj((state) => state.searchbar);
}

export function useEditorAiWindowStore() {
	return useEditorStoreObj((state) => state.aiWindow);
}

export function useEditorActionsStore() {
	return useEditorStoreObj((state) => state.actions);
}

export function useEditorChangeTrackerStore() {
	return useEditorStoreObj((state) => state.changeTracker);
}

export function useEditorBlockSettingsStore() {
	return useEditorStoreObj((state) => state.blockSettings);
}

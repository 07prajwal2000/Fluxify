import { BaseBlockType, EdgeType } from "@/types/block";
import { enableMapSet, produce } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

enableMapSet();

export type EditorActionStateType =
  | ({
      variant: "block";
      actionType: "add" | "edit" | "delete";
    } & BaseBlockType)
  | ({
      variant: "edge";
      actionType: "add" | "delete";
    } & EdgeType);

export enum EditorTab {
  EDITOR = "editor",
  EXECUTIONS = "settings",
  TESTING = "testing",
}

const STACK_SIZE = 20;

type State = {
  tabs: {
    activeTab: EditorTab;
  };
  searchbar: {
    opened: boolean;
    searchQuery: string;
    currentIndex: number;
  };
  aiWindow: {
    opened: boolean;
  };
  actions: {
    undoStack: EditorActionStateType[];
    redoStack: EditorActionStateType[];
    disableRecording: boolean;
  };
  changeTracker: {
    tracker: Map<string, "edge" | "block">;
  };
  blockSettings: {
    opened: boolean;
    blockId: string;
  };
};

type Actions = {
  tabs: {
    setEditorTab: (tab: EditorTab) => void;
  };
  searchbar: {
    open: () => void;
    close: () => void;
    setSearchQuery: (query: string) => void;
    setCurrentIndex: (index: number) => void;
    incrementIndex: (max: number) => void;
    decrementIndex: () => void;
  };
  aiWindow: {
    toggle: () => void;
  };
  reset: () => void;
  actions: {
    record: (action: EditorActionStateType) => void;
    undo: (
      blocks: BaseBlockType[],
      edges: EdgeType[]
    ) => EditorActionStateType | undefined;
    redo: (
      blocks: BaseBlockType[],
      edges: EdgeType[]
    ) => EditorActionStateType | undefined;
    disable: () => void;
    enable: () => void;
    reset: () => void;
  };
  changeTracker: {
    add: (id: string, type: "edge" | "block") => void;
    remove: (id: string) => void;
    reset: () => void;
  };
  blockSettings: {
    open: (id: string) => void;
    close: () => void;
    setBlockId: (id: string) => void;
  };
};

export const useEditorStore = create<State & Actions>()(
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
      undo(blocks, edges) {
        if (get().actions.disableRecording) return;
        if (get().actions.undoStack.length === 0) return;
        let copiedData: EditorActionStateType | undefined;
        set((state) => {
          state.actions = produce(state.actions, (draft) => {
            const item = draft.undoStack.pop()!;
            copiedData = JSON.parse(JSON.stringify(item));
            const listSelected = item.variant === "block" ? blocks : edges;
            const itemToPush =
              listSelected.find((i) => i.id === item.id)! || copiedData;
            if (itemToPush)
              draft.redoStack.push({
                actionType: item.actionType,
                variant: item.variant,
                ...itemToPush,
              } as any);
            if (draft.redoStack.length > STACK_SIZE) {
              draft.redoStack.shift();
            }
          });
        });
        return copiedData;
      },
      redo(blocks, edges) {
        if (get().actions.disableRecording) return;
        if (get().actions.redoStack.length === 0) return;
        let copiedData: EditorActionStateType | undefined;
        set((state) => {
          state.actions = produce(state.actions, (draft) => {
            const item = draft.redoStack.pop()!;
            copiedData = JSON.parse(JSON.stringify(item));
            const listSelected = item.variant === "block" ? blocks : edges;
            const itemToPush =
              listSelected.find((i) => i.id === item.id)! || copiedData;
            if (itemToPush) {
              draft.undoStack.push({
                actionType: item.actionType,
                variant: item.variant,
                ...itemToPush,
              } as any);
            }
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
            }
          );
        });
      },
      remove(id) {
        set((state) => {
          state.changeTracker.tracker = produce(
            state.changeTracker.tracker,
            (draft) => {
              draft.delete(id);
            }
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
  }))
);

export function useEditorTabStore() {
  return useEditorStore((state) => state.tabs);
}

export function useEditorSearchbarStore() {
  return useEditorStore((state) => state.searchbar);
}

export function useEditorAiWindowStore() {
  return useEditorStore((state) => state.aiWindow);
}

export function useEditorActionsStore() {
  return useEditorStore((state) => state.actions);
}

export function useEditorChangeTrackerStore() {
  return useEditorStore((state) => state.changeTracker);
}

export function useEditorBlockSettingsStore() {
  return useEditorStore((state) => state.blockSettings);
}

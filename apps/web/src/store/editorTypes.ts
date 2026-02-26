import { BaseBlockType, EdgeType } from "@/types/block";

export type EditorActionStateType = {
	blocks: BaseBlockType[];
	edges: EdgeType[];
	blockData: Record<string, any>;
};

export enum EditorTab {
	EDITOR = "editor",
	EXECUTIONS = "settings",
	TESTING = "testing",
}

export type State = {
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

export type Actions = {
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
			currentState: EditorActionStateType,
		) => EditorActionStateType | undefined;
		redo: (
			currentState: EditorActionStateType,
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

import { createContext, useContext, type ReactNode } from "react";
import { DISABLED_HISTORY, type CanvasHistory } from "./useCanvasHistory";

const HistoryContext = createContext<CanvasHistory>(DISABLED_HISTORY);

export function CanvasHistoryProvider({
	history,
	children,
}: {
	history: CanvasHistory;
	children: ReactNode;
}) {
	return (
		<HistoryContext.Provider value={history}>{children}</HistoryContext.Provider>
	);
}

/**
 * Undo/redo for anything inside the canvas — toolbar buttons, context menus, and
 * the keyboard shortcut handler. Returns a disabled no-op history when the
 * feature is switched off, so consumers never need a null check.
 */
export function useCanvasHistoryContext(): CanvasHistory {
	return useContext(HistoryContext);
}

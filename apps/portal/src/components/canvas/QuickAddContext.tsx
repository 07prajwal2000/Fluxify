import { createContext, useContext } from "react";
import type { QuickAddContext } from "./quickAdd";

/** Opens the picker for a handle `+` or an edge `+`. Null when the canvas can't be edited. */
const QuickAdd = createContext<((context: QuickAddContext) => void) | null>(null);

export const QuickAddProvider = QuickAdd.Provider;

export function useQuickAdd() {
	return useContext(QuickAdd);
}

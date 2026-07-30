import { createContext, useContext, type ReactNode } from "react";
import type { CanvasChanges } from "./useChangeTracker";

const DISABLED_CHANGES: CanvasChanges = {
	enabled: false,
	dirty: false,
	changes: { blocks: new Map(), edges: new Map() },
	markUpserted: () => {},
	markDeleted: () => {},
	markBlockData: () => {},
	reset: () => {},
};

const ChangesContext = createContext<CanvasChanges>(DISABLED_CHANGES);

export function CanvasChangesProvider({
	value,
	children,
}: {
	value: CanvasChanges;
	children: ReactNode;
}) {
	return (
		<ChangesContext.Provider value={value}>{children}</ChangesContext.Provider>
	);
}

/**
 * Change tracking for anything inside the canvas. Block settings forms call
 * `markBlockData(id)` after editing a block's config. Returns a no-op tracker in
 * readonly mode, so nothing is recorded and callers need no guard.
 */
export function useCanvasChanges(): CanvasChanges {
	return useContext(ChangesContext);
}

export { DISABLED_CHANGES };

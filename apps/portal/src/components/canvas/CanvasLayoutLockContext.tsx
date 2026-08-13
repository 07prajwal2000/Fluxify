import { createContext, useContext, type ReactNode } from "react";

const CanvasLayoutLockContext = createContext(false);

export function CanvasLayoutLockProvider({
	locked,
	children,
}: {
	locked: boolean;
	children: ReactNode;
}) {
	return (
		<CanvasLayoutLockContext.Provider value={locked}>
			{children}
		</CanvasLayoutLockContext.Provider>
	);
}

/** Whether canvas positions and note dimensions are currently protected. */
export function useCanvasLayoutLocked(): boolean {
	return useContext(CanvasLayoutLockContext);
}

import { createContext, type ReactNode, useContext } from "react";

const CanvasReadOnlyContext = createContext(false);

export function CanvasReadOnlyProvider({
	readOnly,
	children,
}: {
	readOnly: boolean;
	children: ReactNode;
}) {
	return (
		<CanvasReadOnlyContext.Provider value={readOnly}>{children}</CanvasReadOnlyContext.Provider>
	);
}

/** Whether the canvas is currently in read-only mode. */
export function useCanvasReadOnly(): boolean {
	return useContext(CanvasReadOnlyContext);
}

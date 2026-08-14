import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type CanvasPlayground = {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	onOpenChange: (nextOpen: boolean) => void;
};

const CanvasPlaygroundContext = createContext<CanvasPlayground | null>(null);

/** Shared playground controls for the canvas trigger and its future UI. */
export function CanvasPlaygroundProvider({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const onOpenChange = useCallback((nextOpen: boolean) => setIsOpen(nextOpen), []);
	const value = useMemo(
		() => ({ isOpen, open, close, onOpenChange }),
		[close, isOpen, onOpenChange, open],
	);

	return (
		<CanvasPlaygroundContext.Provider value={value}>
			{children}
		</CanvasPlaygroundContext.Provider>
	);
}

export function useCanvasPlayground(): CanvasPlayground {
	const playground = useContext(CanvasPlaygroundContext);
	if (!playground) {
		throw new Error("useCanvasPlayground must be used within CanvasPlaygroundProvider");
	}
	return playground;
}

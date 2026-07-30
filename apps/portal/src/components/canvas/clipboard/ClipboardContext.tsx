import { createContext, useContext, type ReactNode } from "react";
import type { CanvasClipboard } from "./useClipboard";

export const DISABLED_CLIPBOARD: CanvasClipboard = {
	enabled: false,
	canPaste: false,
	copy: () => 0,
	paste: () => {},
	duplicate: () => {},
};

const ClipboardContext = createContext<CanvasClipboard>(DISABLED_CLIPBOARD);

export function CanvasClipboardProvider({
	value,
	children,
}: {
	value: CanvasClipboard;
	children: ReactNode;
}) {
	return (
		<ClipboardContext.Provider value={value}>{children}</ClipboardContext.Provider>
	);
}

/**
 * Copy/paste/duplicate for anything inside the canvas — the block toolbar, a
 * context menu, or the keyboard layer. Returns no-ops when the feature is off, so
 * callers need no guard.
 */
export function useCanvasClipboard(): CanvasClipboard {
	return useContext(ClipboardContext);
}

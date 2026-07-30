import { createContext, useContext, type ReactNode } from "react";
import type { CanvasPanel } from "./useBlockPanel";

export const DISABLED_PANEL: CanvasPanel = {
	enabled: false,
	openBlockId: null,
	open: () => {},
	close: () => {},
};

const PanelContext = createContext<CanvasPanel>(DISABLED_PANEL);

export function CanvasPanelProvider({
	value,
	children,
}: {
	value: CanvasPanel;
	children: ReactNode;
}) {
	return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

/**
 * The settings panel, for anything that wants to open a block: the block toolbar,
 * a context menu, the keyboard layer. No-ops when the panel is disabled.
 */
export function useCanvasPanel(): CanvasPanel {
	return useContext(PanelContext);
}

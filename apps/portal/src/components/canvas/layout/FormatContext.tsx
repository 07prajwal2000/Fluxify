import { createContext, useContext, type ReactNode } from "react";

export type CanvasFormat = {
	enabled: boolean;
	/** Re-lays the graph out horizontally. Resolves once positions are applied. */
	format: () => Promise<void>;
	isFormatting: boolean;
};

const DISABLED_FORMAT: CanvasFormat = {
	enabled: false,
	format: async () => {},
	isFormatting: false,
};

const FormatContext = createContext<CanvasFormat>(DISABLED_FORMAT);

export function CanvasFormatProvider({
	value,
	children,
}: {
	value: CanvasFormat;
	children: ReactNode;
}) {
	return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

/** Format action for toolbars, context menus and keyboard shortcuts. */
export function useCanvasFormat(): CanvasFormat {
	return useContext(FormatContext);
}

export { DISABLED_FORMAT };

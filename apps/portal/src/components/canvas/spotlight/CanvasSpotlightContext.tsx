import { createContext, useContext } from "react";

export type CanvasSpotlightContextValue = {
	enabled: boolean;
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
};

const CanvasSpotlightContext = createContext<CanvasSpotlightContextValue>({
	enabled: false,
	isOpen: false,
	open: () => {},
	close: () => {},
	toggle: () => {},
});

export const CanvasSpotlightProvider = CanvasSpotlightContext.Provider;

export function useCanvasSpotlight(): CanvasSpotlightContextValue {
	return useContext(CanvasSpotlightContext);
}

import type { RefObject } from "react";
import type { CanvasAction } from "../actions";
import { useCanvasKeyboard } from "./useCanvasKeyboard";

export type CanvasKeyboardLayerProps = {
	enabled: boolean;
	rootRef: RefObject<HTMLElement | null>;
	actions: CanvasAction[];
};

/**
 * Renders nothing — it exists so the shortcut bindings live inside the canvas
 * providers, next to the actions they run.
 */
export function CanvasKeyboardLayer({
	enabled,
	rootRef,
	actions,
}: CanvasKeyboardLayerProps) {
	useCanvasKeyboard({ enabled, rootRef, actions });
	return null;
}

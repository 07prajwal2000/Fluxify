import { useCallback, useMemo, useState } from "react";

export type MenuPosition = { x: number; y: number };

export type CanvasContextMenuState = {
	enabled: boolean;
	position: MenuPosition | null;
	isOpen: boolean;
	/** Swallows the browser menu and opens ours where the pointer is. */
	openAt: (event: { clientX: number; clientY: number; preventDefault: () => void }) => void;
	close: () => void;
};

/** Where the canvas context menu is, and whether it is showing. */
export function useContextMenu(enabled: boolean): CanvasContextMenuState {
	const [position, setPosition] = useState<MenuPosition | null>(null);

	const openAt = useCallback(
		(event: { clientX: number; clientY: number; preventDefault: () => void }) => {
			if (!enabled) return;
			event.preventDefault();
			setPosition({ x: event.clientX, y: event.clientY });
		},
		[enabled],
	);

	const close = useCallback(() => setPosition(null), []);

	return useMemo(
		() => ({ enabled, position, isOpen: enabled && position !== null, openAt, close }),
		[enabled, position, openAt, close],
	);
}

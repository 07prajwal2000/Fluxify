import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_PANEL_WIDTH = 550;
export const MIN_PANEL_WIDTH = 470;
export const MAX_PANEL_WIDTH = 850;
export const PANEL_WIDTH_STORAGE_KEY = "fx-block-panel-width";
export const CLOSE_WIDTH_THRESHOLD = 450;
export const CLOSE_DELTA_THRESHOLD = 120;

/** Retrieves saved panel width from localStorage with bounds checking. */
export function getStoredPanelWidth(
	storageKey = PANEL_WIDTH_STORAGE_KEY,
	defaultWidth = DEFAULT_PANEL_WIDTH,
	minWidth = MIN_PANEL_WIDTH,
	maxWidth = MAX_PANEL_WIDTH,
): number {
	if (typeof localStorage === "undefined") return defaultWidth;
	try {
		const saved = localStorage.getItem(storageKey);
		if (saved) {
			const parsed = Number.parseInt(saved, 10);
			if (!Number.isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
				return parsed;
			}
		}
	} catch {
		// Ignore storage errors (SSR, iframe restrictions)
	}
	return defaultWidth;
}

/** Saves panel width to localStorage. */
export function setStoredPanelWidth(
	width: number,
	storageKey = PANEL_WIDTH_STORAGE_KEY,
) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(storageKey, Math.round(width).toString());
	} catch {
		// Ignore storage errors
	}
}

export type UseBlockPanelResizeOptions = {
	storageKey?: string;
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	onClose?: () => void;
};

/**
 * Hook providing drag-to-resize state, persistence, double-click reset, and mouse/touch/keyboard handlers
 * for the block settings side panel. Instantly closes the panel mid-drag if target width < 450px with 120px+ delta.
 */
export function useBlockPanelResize(options: UseBlockPanelResizeOptions = {}) {
	const {
		storageKey = PANEL_WIDTH_STORAGE_KEY,
		defaultWidth = DEFAULT_PANEL_WIDTH,
		minWidth = MIN_PANEL_WIDTH,
		maxWidth = MAX_PANEL_WIDTH,
		onClose,
	} = options;

	const [width, setWidth] = useState<number>(() =>
		getStoredPanelWidth(storageKey, defaultWidth, minWidth, maxWidth),
	);
	const [isResizing, setIsResizing] = useState(false);

	const startXRef = useRef<number>(0);
	const startWidthRef = useRef<number>(width);
	const latestUnconstrainedWidthRef = useRef<number>(width);
	const latestDeltaRef = useRef<number>(0);

	const clampWidth = useCallback(
		(w: number) => {
			const maxAllowed = Math.min(
				maxWidth,
				typeof window !== "undefined" ? window.innerWidth - 80 : maxWidth,
			);
			return Math.min(maxAllowed, Math.max(minWidth, w));
		},
		[minWidth, maxWidth],
	);

	const startResizing = useCallback(
		(clientX: number) => {
			startXRef.current = clientX;
			startWidthRef.current = width;
			latestUnconstrainedWidthRef.current = width;
			latestDeltaRef.current = 0;
			setIsResizing(true);
			if (typeof document !== "undefined") {
				document.body.style.userSelect = "none";
				document.body.style.cursor = "col-resize";
			}
		},
		[width],
	);

	const stopResizing = useCallback(() => {
		setIsResizing(false);
		if (typeof document !== "undefined") {
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		}
	}, []);

	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!isResizing) return;

		const handlePointerMove = (e: MouseEvent | TouchEvent) => {
			const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
			// Panel is positioned on the right edge. Dragging left (decreasing clientX)
			// increases panel width. Dragging right (increasing clientX) decreases width.
			const deltaX = startXRef.current - clientX;
			const unconstrainedWidth = startWidthRef.current + deltaX;
			const shrinkDelta = startWidthRef.current - unconstrainedWidth;

			latestUnconstrainedWidthRef.current = unconstrainedWidth;
			latestDeltaRef.current = shrinkDelta;

			// Instant close mid-drag as soon as threshold is crossed
			if (
				unconstrainedWidth < CLOSE_WIDTH_THRESHOLD &&
				shrinkDelta >= CLOSE_DELTA_THRESHOLD &&
				onCloseRef.current
			) {
				stopResizing();
				onCloseRef.current();
				return;
			}

			const newWidth = clampWidth(unconstrainedWidth);
			setWidth(newWidth);
			setStoredPanelWidth(newWidth, storageKey);
		};

		const handlePointerUp = () => {
			stopResizing();
			const targetWidth = latestUnconstrainedWidthRef.current;
			const shrinkDelta = latestDeltaRef.current;

			if (
				targetWidth < CLOSE_WIDTH_THRESHOLD &&
				shrinkDelta >= CLOSE_DELTA_THRESHOLD &&
				onCloseRef.current
			) {
				onCloseRef.current();
			}
		};

		window.addEventListener("mousemove", handlePointerMove);
		window.addEventListener("mouseup", handlePointerUp);
		window.addEventListener("touchmove", handlePointerMove);
		window.addEventListener("touchend", handlePointerUp);

		return () => {
			window.removeEventListener("mousemove", handlePointerMove);
			window.removeEventListener("mouseup", handlePointerUp);
			window.removeEventListener("touchmove", handlePointerMove);
			window.removeEventListener("touchend", handlePointerUp);
		};
	}, [isResizing, clampWidth, storageKey, stopResizing]);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			startResizing(e.clientX);
		},
		[startResizing],
	);

	const handleTouchStart = useCallback(
		(e: React.TouchEvent) => {
			if (e.touches.length === 1) {
				startResizing(e.touches[0].clientX);
			}
		},
		[startResizing],
	);

	const handleDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setWidth(defaultWidth);
			setStoredPanelWidth(defaultWidth, storageKey);
		},
		[defaultWidth, storageKey],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			let nextWidth = width;
			if (e.key === "ArrowLeft") {
				nextWidth = clampWidth(width + 20);
			} else if (e.key === "ArrowRight") {
				nextWidth = clampWidth(width - 20);
			} else if (e.key === "Home") {
				nextWidth = minWidth;
			} else if (e.key === "End") {
				nextWidth = clampWidth(maxWidth);
			} else {
				return;
			}
			e.preventDefault();
			setWidth(nextWidth);
			setStoredPanelWidth(nextWidth, storageKey);
		},
		[width, clampWidth, minWidth, maxWidth, storageKey],
	);

	return {
		width,
		isResizing,
		handleMouseDown,
		handleTouchStart,
		handleDoubleClick,
		handleKeyDown,
		minWidth,
		maxWidth,
	};
}

import { useCallback, useState } from "react";

/** Shared picker controls for buttons, keyboard shortcuts, and other triggers. */
export function useBlockPicker() {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const onOpenChange = useCallback((nextOpen: boolean) => setIsOpen(nextOpen), []);

	return { isOpen, open, close, onOpenChange };
}

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type KeyboardShortcuts = {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	onOpenChange: (nextOpen: boolean) => void;
};

const KeyboardShortcutsContext = createContext<KeyboardShortcuts>({
	isOpen: false,
	open: () => {},
	close: () => {},
	onOpenChange: () => {},
});

export function KeyboardShortcutsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const onOpenChange = useCallback(
		(nextOpen: boolean) => setIsOpen(nextOpen),
		[],
	);
	const value = useMemo(
		() => ({ isOpen, open, close, onOpenChange }),
		[close, isOpen, onOpenChange, open],
	);

	return (
		<KeyboardShortcutsContext.Provider value={value}>
			{children}
		</KeyboardShortcutsContext.Provider>
	);
}

export function useKeyboardShortcuts(): KeyboardShortcuts {
	return useContext(KeyboardShortcutsContext);
}

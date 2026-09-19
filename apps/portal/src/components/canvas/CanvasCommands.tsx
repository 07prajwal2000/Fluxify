import { type RefObject, useState } from "react";
import { useCanvasActions } from "./actions";
import type { BlockType } from "./blocks";
import { CanvasContextMenu, type CanvasContextMenuState, type MenuPosition } from "./contextMenu";
import { CanvasKeyboardLayer, KeyboardShortcutsModal, useKeyboardShortcuts } from "./keyboard";
import { CanvasSpotlight, useSpotlightCommands } from "./spotlight";

export type CanvasCommandsProps = {
	readOnly: boolean;
	enableKeyboard: boolean;
	menu: CanvasContextMenuState;
	/** Scope for the shortcuts: the canvas *and* its side panel. */
	rootRef: RefObject<HTMLElement | null>;
	onSave?: () => void;
	/** `at` is the viewport point the menu was opened at, absent for a shortcut. */
	onAddBlock?: (at?: MenuPosition) => void;
	onAddNote?: (at?: MenuPosition) => void;
	enableSpotlight?: boolean;
	onAddBlockType?: (type: BlockType) => void;
	enablePlayground?: boolean;
	onOpenPlayground?: () => void;
};

/**
 * Shortcuts and the right-click menu, built from one action list.
 *
 * Rendered inside the canvas providers rather than beside them, because the
 * actions read the clipboard, history, format and panel contexts — the same
 * ones the toolbar and the block actions use, so every entry point stays in
 * agreement about what is currently possible.
 */
export function CanvasCommands({
	readOnly,
	enableKeyboard,
	menu,
	rootRef,
	onSave,
	onAddBlock,
	onAddNote,
	enableSpotlight = false,
	onAddBlockType,
	enablePlayground,
	onOpenPlayground,
}: CanvasCommandsProps) {
	const [spotlightOpen, setSpotlightOpen] = useState(false);
	const shortcuts = useKeyboardShortcuts();

	// The menu's position is still set while an item runs (`close()` only lands on
	// the next render), so a block added from the menu goes under the pointer,
	// while the same action from a shortcut gets no position and lands centred.
	const { list } = useCanvasActions({
		readOnly,
		onSave,
		onAddBlock: onAddBlock && (() => onAddBlock(menu.position ?? undefined)),
		onAddNote: onAddNote && (() => onAddNote(menu.position ?? undefined)),
		onOpenSpotlight: enableSpotlight ? () => setSpotlightOpen(true) : undefined,
	});

	const spotlightCommands = useSpotlightCommands({
		actions: list,
		onAddBlock: onAddBlockType,
		enablePlayground,
		onOpenPlayground,
		onOpenShortcuts: shortcuts.open,
		onClose: () => setSpotlightOpen(false),
	});

	return (
		<>
			<CanvasKeyboardLayer enabled={enableKeyboard} rootRef={rootRef} actions={list} />
			<CanvasContextMenu menu={menu} actions={list} />
			{enableSpotlight && (
				<CanvasSpotlight
					isOpen={spotlightOpen}
					onOpenChange={setSpotlightOpen}
					commands={spotlightCommands}
				/>
			)}
			<KeyboardShortcutsModal isOpen={shortcuts.isOpen} onOpenChange={shortcuts.onOpenChange} />
		</>
	);
}

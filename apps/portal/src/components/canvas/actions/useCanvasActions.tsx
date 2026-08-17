import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useOnSelectionChange, useReactFlow } from "@xyflow/react";
import {
	TbArrowBackUp,
	TbArrowForwardUp,
	TbClipboardText,
	TbCopy,
	TbDownload,
	TbExternalLink,
	TbFileImport,
	TbNote,
	TbPlus,
	TbTrash,
	TbDeviceFloppy,
} from "react-icons/tb";
import { MdFormatPaint } from "react-icons/md";
import { useCanvasClipboard } from "../clipboard";
import { useCanvasHistoryContext } from "../history";
import { useCanvasFormat } from "../layout";
import { useCanvasPanel } from "../panel";
import type { BlockEdge, BlockNode } from "../types";

export type CanvasActionId =
	| "open"
	| "addBlock"
	| "addNote"
	| "undo"
	| "redo"
	| "copy"
	| "paste"
	| "duplicate"
	| "export"
	| "import"
	| "format"
	| "delete"
	| "save";

export type CanvasAction = {
	id: CanvasActionId;
	label: string;
	/** See `combo.ts`. Absent = menu-only, no shortcut. */
	combo?: string;
	icon: ReactNode;
	/** This canvas doesn't offer the action at all — keep it out of the menu. */
	available: boolean;
	/** Offered, but nothing to act on right now. */
	disabled: boolean;
	danger?: boolean;
	/** Starts a new group in the menu. */
	startsGroup?: boolean;
	run: () => void;
};

export type UseCanvasActionsOptions = {
	readOnly: boolean;
	/** Absent = this host has no save (an embedded or preview canvas). */
	onSave?: () => void;
	onAddBlock?: () => void;
	onAddNote?: () => void;
};

export type CanvasActions = {
	list: CanvasAction[];
	selectedBlockIds: string[];
	selectedEdgeIds: string[];
};

/**
 * Every canvas command in one place, already resolved against the features this
 * canvas has switched on. The context menu renders the list and the keyboard
 * layer matches combos against it, so an action can never be enabled in one and
 * disabled in the other.
 */
export function useCanvasActions({
	readOnly,
	onSave,
	onAddBlock,
	onAddNote,
}: UseCanvasActionsOptions): CanvasActions {
	const { deleteElements } = useReactFlow();
	const clipboard = useCanvasClipboard();
	const history = useCanvasHistoryContext();
	const format = useCanvasFormat();
	const panel = useCanvasPanel();

	const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
	const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

	const onSelectionChange = useCallback(
		({ nodes, edges }: { nodes: BlockNode[]; edges: BlockEdge[] }) => {
			setSelectedBlockIds(nodes.map((node) => node.id));
			setSelectedEdgeIds(edges.map((edge) => edge.id));
		},
		[],
	);
	useOnSelectionChange({ onChange: onSelectionChange });

	const hasBlocks = selectedBlockIds.length > 0;
	const hasSelection = hasBlocks || selectedEdgeIds.length > 0;

	const list = useMemo<CanvasAction[]>(
		() => [
			{
				id: "open",
				label: "Open settings",
				combo: "enter",
				icon: <TbExternalLink size={14} />,
				available: panel.enabled,
				// One block at a time — the panel shows exactly one.
				disabled: selectedBlockIds.length !== 1,
				run: () => panel.open(selectedBlockIds[0]),
			},
			{
				id: "addBlock",
				label: "Add block",
				combo: "shift+a",
				icon: <TbPlus size={14} />,
				available: !readOnly && !!onAddBlock,
				disabled: false,
				startsGroup: true,
				run: () => onAddBlock?.(),
			},
			{
				id: "addNote",
				label: "Add note",
				icon: <TbNote size={14} />,
				available: !readOnly && !!onAddNote,
				disabled: false,
				run: () => onAddNote?.(),
			},
			{
				id: "undo",
				label: "Undo",
				combo: "mod+z",
				icon: <TbArrowBackUp size={14} />,
				available: history.enabled,
				disabled: !history.canUndo,
				startsGroup: true,
				run: history.undo,
			},
			{
				id: "redo",
				label: "Redo",
				combo: "mod+shift+z",
				icon: <TbArrowForwardUp size={14} />,
				available: history.enabled,
				disabled: !history.canRedo,
				run: history.redo,
			},
			{
				id: "copy",
				label: "Copy",
				combo: "mod+c",
				icon: <TbCopy size={14} />,
				available: clipboard.enabled,
				disabled: !hasBlocks,
				startsGroup: true,
				run: () => clipboard.copy(),
			},
			{
				id: "paste",
				label: "Paste",
				combo: "mod+v",
				icon: <TbClipboardText size={14} />,
				available: clipboard.enabled,
				disabled: false,
				run: () => void clipboard.paste(),
			},
			{
				id: "duplicate",
				label: "Duplicate",
				combo: "shift+d",
				icon: <TbCopy size={14} />,
				available: clipboard.enabled,
				disabled: !hasBlocks,
				run: () => clipboard.duplicate(selectedBlockIds),
			},
			{
				id: "export",
				label: "Export selection…",
				combo: "mod+e",
				icon: <TbDownload size={14} />,
				available: true,
				disabled: !hasBlocks,
				startsGroup: true,
				run: () => clipboard.exportSelection(selectedBlockIds),
			},
			{
				id: "import",
				label: "Import from file…",
				combo: "mod+i",
				icon: <TbFileImport size={14} />,
				available: clipboard.enabled,
				disabled: false,
				run: () => void clipboard.importFromFile(),
			},
			{
				id: "format",
				label: "Format blocks",
				combo: "shift+f",
				icon: <MdFormatPaint size={14} />,
				available: format.enabled,
				disabled: format.isFormatting,
				startsGroup: true,
				run: () => void format.format(),
			},
			{
				id: "delete",
				// Delete/Backspace is React Flow's own key handling — no combo here,
				// or the deletion would run twice.
				label: "Delete",
				icon: <TbTrash size={14} />,
				available: !readOnly,
				disabled: !hasSelection,
				danger: true,
				run: () =>
					void deleteElements({
						nodes: selectedBlockIds.map((id) => ({ id })),
						edges: selectedEdgeIds.map((id) => ({ id })),
					}),
			},
			{
				id: "save",
				label: "Save",
				combo: "mod+s",
				icon: <TbDeviceFloppy size={14} />,
				available: !readOnly && !!onSave,
				disabled: false,
				startsGroup: true,
				run: () => onSave?.(),
			},
		],
		[
			readOnly,
			panel,
			history,
			clipboard,
			format,
			deleteElements,
			onAddBlock,
			onAddNote,
			onSave,
			selectedBlockIds,
			selectedEdgeIds,
			hasBlocks,
			hasSelection,
		],
	);

	return { list, selectedBlockIds, selectedEdgeIds };
}

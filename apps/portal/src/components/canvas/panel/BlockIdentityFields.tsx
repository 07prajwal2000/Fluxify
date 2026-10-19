import { useReactFlow } from "@xyflow/react";
import { type KeyboardEvent, useCallback, useState } from "react";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData } from "../types";

/** Values the server fills in when nothing was typed — treat them as empty. */
const PLACEHOLDERS = new Set(["Name", "Description"]);

function stored(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	return PLACEHOLDERS.has(trimmed) ? "" : value;
}

export type BlockField = "blockName" | "blockDescription";

type FieldBinding = {
	value: string;
	editable: boolean;
	onChange: (value: string) => void;
	commit: () => void;
};

/**
 * One editable block field. Kept local while typing and written on blur, so the
 * change tracker sees one edit per field rather than one per keystroke. Empty
 * means "use the catalog text", which is what the placeholder shows.
 */
function useBlockField(blockId: string, field: BlockField, data: BlockData): FieldBinding {
	const { updateNodeData } = useReactFlow();
	// Tracking disabled means a readonly canvas: show the value, don't edit it.
	const { enabled: editable } = useCanvasChanges();
	const [value, setValue] = useState(() => stored(data[field]));

	const commit = useCallback(() => {
		const next = value.trim();
		if (next === stored(data[field]).trim()) return;
		updateNodeData(blockId, { [field]: next });
	}, [blockId, data, field, updateNodeData, value]);

	return { value, editable, onChange: setValue, commit };
}

export type BlockFieldProps = {
	blockId: string;
	data: BlockData;
	/** Catalog text, shown while the field is empty. */
	placeholder: string;
};

/**
 * The name and description live in the panel header, as plain inputs that look
 * like text until hovered or focused (HeroUI's inputs are too tall for a header).
 * Styles: `.fx-panel__field` in panel.css.
 */

/** The block's name. */
export function BlockNameInput({ blockId, data, placeholder }: BlockFieldProps) {
	const { value, editable, onChange, commit } = useBlockField(blockId, "blockName", data);

	const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") event.currentTarget.blur();
	}, []);

	return (
		<input
			className="fx-panel__field fx-panel__name"
			aria-label="Block name"
			title={editable ? "Click to rename" : value || placeholder}
			readOnly={!editable}
			value={value}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
			onBlur={commit}
			onKeyDown={onKeyDown}
		/>
	);
}

/** The block's description — grows with its text, up to a few lines. */
export function BlockDescriptionField({ blockId, data, placeholder }: BlockFieldProps) {
	const { value, editable, onChange, commit } = useBlockField(blockId, "blockDescription", data);

	return (
		<textarea
			className="fx-panel__field fx-panel__type"
			aria-label="Block description"
			title={editable ? "Click to edit the description" : value || placeholder}
			readOnly={!editable}
			rows={1}
			value={value}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
			onBlur={commit}
		/>
	);
}

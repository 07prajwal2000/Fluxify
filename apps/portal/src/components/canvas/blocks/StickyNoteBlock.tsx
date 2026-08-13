import { useCallback, useState, type KeyboardEvent, type MouseEvent } from "react";
import Markdown from "react-markdown";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { TbTrash } from "react-icons/tb";
import "./blocks.css";
import { useCanvasChanges } from "../changes/ChangesContext";
import { useCanvasLayoutLocked } from "../CanvasLayoutLockContext";
import { NOTE_COLORS, NOTE_MIN_SIZE, stickyNoteData } from "./stickyNoteData";

/**
 * A resizable comment on the canvas: renders its `notes` as markdown and has no
 * sockets, so it never takes part in the flow. Double click edits the markdown in
 * place; selecting it shows React Flow's resize frame plus a colour strip.
 *
 * The box lives on the node (`width`/`height`), which React Flow owns while the
 * drag runs — dragging a top/left knob moves the node too, and writing the size
 * back into `data` from here would replace the node with a pre-drag snapshot and
 * undo that move. `nodeToBlock` copies the final box into `data.size` at save
 * time instead.
 */
export function StickyNoteBlock({ id, data, selected }: NodeProps) {
	const note = stickyNoteData(data);
	const { deleteElements, updateNode, updateNodeData } = useReactFlow();
	// Disabled tracking means a readonly canvas: view the note, don't edit it.
	const { enabled: editable } = useCanvasChanges();
	const layoutLocked = useCanvasLayoutLocked();
	// `null` = not editing; anything else is the in-progress markdown.
	const [draft, setDraft] = useState<string | null>(null);

	const startEditing = useCallback(
		(event: MouseEvent) => {
			if (!editable) return;
			// Otherwise React Flow zooms in on the double click.
			event.stopPropagation();
			// A note is normally a background grouping layer. Raise it only while
			// its editor needs to receive the pointer and keyboard interaction.
			updateNode(id, { zIndex: 1 });
			setDraft(note.notes);
		},
		[editable, id, note.notes, updateNode],
	);

	const commit = useCallback(() => {
		setDraft((current) => {
			if (current !== null && current !== note.notes) {
				updateNodeData(id, { notes: current });
			}
			return null;
		});
		updateNode(id, { zIndex: -1 });
	}, [id, note.notes, updateNode, updateNodeData]);

	const cancel = useCallback(() => {
		setDraft(null);
		updateNode(id, { zIndex: -1 });
	}, [id, updateNode]);

	const remove = useCallback(() => {
		void deleteElements({ nodes: [{ id }] });
	}, [deleteElements, id]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			// Stop the canvas from treating typing as shortcuts (delete, undo…).
			event.stopPropagation();
			if (event.key === "Escape") cancel();
			else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
		},
		[cancel, commit],
	);

	return (
		<div
			data-block-id={id}
			data-block-type="sticky_note"
			className={`fx-block fx-block--note fx-block--note-${note.color}${
				selected ? " fx-block--selected" : ""
			}`}
			onDoubleClick={startEditing}
		>
			<NodeResizer
				nodeId={id}
				isVisible={selected && editable && !layoutLocked}
				minWidth={NOTE_MIN_SIZE}
				minHeight={NOTE_MIN_SIZE}
				handleClassName="fx-note__grip"
				lineClassName="fx-note__edge"
			/>

			{selected && editable && (
				<div className="fx-note__palette nodrag">
					{NOTE_COLORS.map((color) => (
						<button
							key={color}
							type="button"
							title={color}
							aria-label={`${color} note`}
							aria-pressed={color === note.color}
							className={`fx-note__swatch fx-note__swatch--${color}${
								color === note.color ? " fx-note__swatch--active" : ""
							}`}
							onClick={() => updateNodeData(id, { color })}
						/>
					))}
					<button
						type="button"
						title="Delete note"
						aria-label="Delete note"
						className="fx-note__swatch fx-note__delete"
						onClick={remove}
					>
						<TbTrash />
					</button>
				</div>
			)}

			{draft === null ? (
				<div className="fx-note__body">
					{note.notes.trim() ? (
						<Markdown>{note.notes}</Markdown>
					) : (
						<span className="fx-note__placeholder">
							Note — double click to edit
						</span>
					)}
				</div>
			) : (
				<textarea
					// nodrag/nopan/nowheel keep the canvas from stealing the interaction.
					className="fx-note__editor nodrag nopan nowheel"
					// biome-ignore lint/a11y/noAutofocus: editing starts on double click
					autoFocus
					value={draft}
					placeholder="Markdown…"
					spellCheck={false}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={onKeyDown}
				/>
			)}
		</div>
	);
}

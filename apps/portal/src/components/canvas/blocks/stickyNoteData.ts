export const NOTE_COLORS = ["yellow", "red", "green", "blue"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export type NoteSize = { width: number; height: number };

/** The shape a note is stored (and validated) in — notes, colour and size. */
export type StickyNoteData = {
	notes: string;
	color: NoteColor;
	size: NoteSize;
};

/** Notes can grow without a cap, but must remain usable on the canvas. */
export const NOTE_MIN_SIZE = 50;

const DEFAULT_SIZE: NoteSize = { width: 180, height: 120 };
const NEW_NOTE_SIZE: NoteSize = { width: 180, height: 180 };

function dimension(value: unknown, fallback: number) {
	const size =
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.max(Math.round(size), NOTE_MIN_SIZE);
}

/**
 * Fills in every field a note must have. The saved payload is validated against
 * a strict schema (`notes` and `size` required, box capped at 200×200), so an
 * incomplete `data` — a note the AI added, or an older one — gets rejected by the
 * server. Normalising on load and writing the whole object back keeps it savable.
 */
export function stickyNoteData(data: unknown): StickyNoteData {
	const record = (data ?? {}) as Record<string, unknown>;
	const size = (record.size ?? {}) as Record<string, unknown>;
	const color = record.color;

	return {
		notes: typeof record.notes === "string" ? record.notes : "",
		color: NOTE_COLORS.includes(color as NoteColor)
			? (color as NoteColor)
			: "yellow",
		size: {
			width: dimension(size.width, DEFAULT_SIZE.width),
			height: dimension(size.height, DEFAULT_SIZE.height),
		},
	};
}

/** New canvas notes start square; existing note dimensions are never rewritten. */
export function newStickyNoteData(): StickyNoteData {
	return stickyNoteData({ size: NEW_NOTE_SIZE });
}

export const NOTE_COLORS = ["yellow", "red", "green", "blue"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export type NoteSize = { width: number; height: number };

/** The shape a note is stored (and validated) in — notes, colour and size. */
export type StickyNoteData = {
	notes: string;
	color: NoteColor;
	size: NoteSize;
};

/** Bounds the server enforces on a note's box; the resizer must not exceed them. */
export const NOTE_SIZE_LIMITS = {
	minWidth: 75,
	minHeight: 75,
	maxWidth: 200,
	maxHeight: 200,
} as const;

const DEFAULT_SIZE: NoteSize = { width: 180, height: 120 };

function dimension(value: unknown, fallback: number, min: number, max: number) {
	const size =
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(Math.max(Math.round(size), min), max);
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
			width: dimension(
				size.width,
				DEFAULT_SIZE.width,
				NOTE_SIZE_LIMITS.minWidth,
				NOTE_SIZE_LIMITS.maxWidth,
			),
			height: dimension(
				size.height,
				DEFAULT_SIZE.height,
				NOTE_SIZE_LIMITS.minHeight,
				NOTE_SIZE_LIMITS.maxHeight,
			),
		},
	};
}

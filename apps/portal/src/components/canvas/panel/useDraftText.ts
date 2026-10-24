import { useEffect, useRef, useState } from "react";

export const toText = (value: unknown) =>
	typeof value === "string"
		? value
		: value && typeof value === "object"
			? JSON.stringify(value)
			: value == null
				? ""
				: String(value);

/** Numeric-looking text is stored as a number; `js:` expressions stay text. */
export const toNumberIfNumeric = (next: string): unknown => {
	const trimmed = next.trim();
	return trimmed !== "" && !trimmed.startsWith("js:") && !Number.isNaN(Number(trimmed))
		? Number(trimmed)
		: next;
};

/**
 * The text a field shows while typing. The input renders the raw draft, never
 * the stored value, so normalising on write (`1.` → 1) can't rewrite the DOM
 * value and reset the caret. The draft re-syncs only when the stored value
 * changes to something this field didn't write (AI / API edits).
 */
export function useDraftText(
	stored: unknown,
	write: (value: unknown) => void,
	toStored: (text: string) => unknown = (text) => text,
) {
	const storedText = toText(stored);
	const [draft, setDraft] = useState(storedText);
	const written = useRef(storedText);

	useEffect(() => {
		if (storedText === written.current) return;
		written.current = storedText;
		setDraft(storedText);
	}, [storedText]);

	const onChange = (next: string) => {
		const value = toStored(next);
		written.current = toText(value);
		setDraft(next);
		write(value);
	};

	return [draft, onChange] as const;
}

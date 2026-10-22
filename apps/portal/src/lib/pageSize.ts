import { useState } from "react";

/** The page sizes the list APIs accept (their perPage is capped at 5–50). */
export const PAGE_SIZES = [5, 10, 20, 50];

/** The saved size, or `fallback` when none is saved, it is not an allowed size, or storage is blocked. */
export function readPageSize(storageKey: string, fallback: number) {
	try {
		const saved = Number(localStorage.getItem(storageKey));
		return PAGE_SIZES.includes(saved) ? saved : fallback;
	} catch {
		return fallback;
	}
}

/**
 * A list's rows-per-page, remembered in localStorage under `key` so it survives
 * leaving the page and coming back.
 */
export function usePageSize(key: string, fallback = PAGE_SIZES[0]) {
	const storageKey = `fluxify.pageSize.${key}`;
	const [size, setSize] = useState(() => readPageSize(storageKey, fallback));
	const update = (next: number) => {
		setSize(next);
		try {
			localStorage.setItem(storageKey, String(next));
		} catch {
			// storage full or blocked: the size still applies for this visit
		}
	};
	return [size, update] as const;
}

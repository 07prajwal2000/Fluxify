import { useEffect, useRef, useState } from "react";

export const CANVAS_POLL_MS = 5000;

export type CanvasPollState = {
	/** the revision the canvas on screen was loaded at; undefined while loading */
	revision: number | undefined;
	isDirty: boolean;
	isSaving: boolean;
	getRevision: () => Promise<number>;
	/** quiet reload, for a canvas with no unsaved edits */
	reload: () => unknown;
};

/**
 * One poll (#597): a newer canvas on the server reloads a clean canvas quietly,
 * and returns "stale" for one with unsaved edits so the user decides.
 * `read` gives the state as it is now, since edits or a save may start mid-request.
 */
export async function pollCanvasRevision(read: () => CanvasPollState): Promise<"stale" | void> {
	const before = read();
	if (document.visibilityState !== "visible" || before.isSaving || before.revision === undefined) {
		return;
	}
	const remote = await before.getRevision().catch(() => undefined);
	const now = read();
	if (
		remote === undefined ||
		now.isSaving ||
		now.revision === undefined ||
		remote <= now.revision
	) {
		return;
	}
	if (now.isDirty) return "stale";
	now.reload();
}

/** Polls while the tab is visible; true once the server moved past unsaved edits. */
export function useCanvasPoll(state: CanvasPollState) {
	const [stale, setStale] = useState(false);
	const latest = useRef(state);
	latest.current = state;

	// a fresh load (a reload, or the refetch after our own save) is the new baseline
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new revision only
	useEffect(() => setStale(false), [state.revision]);

	useEffect(() => {
		let busy = false;
		const timer = setInterval(async () => {
			if (busy) return;
			busy = true;
			try {
				if ((await pollCanvasRevision(() => latest.current)) === "stale") setStale(true);
			} finally {
				busy = false;
			}
		}, CANVAS_POLL_MS);
		return () => clearInterval(timer);
	}, []);

	return stale;
}

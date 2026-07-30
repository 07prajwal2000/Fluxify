/**
 * Pure undo/redo stack over graph snapshots — no React, no React Flow, so it can
 * be unit tested and reused by any host that can read/write a snapshot.
 *
 * `undo`/`redo` take the *current* snapshot and return the one to apply, which
 * is what keeps the two stacks consistent without the caller tracking a
 * "present" entry.
 */
export type HistoryStack<T> = {
	commit: (current: T) => void;
	undo: (current: T) => T | null;
	redo: (current: T) => T | null;
	clear: () => void;
	sizes: () => { past: number; future: number };
};

export function createHistoryStack<T>(limit = 50): HistoryStack<T> {
	let past: T[] = [];
	let future: T[] = [];

	return {
		commit(current) {
			past = [...past, current].slice(-limit);
			future = [];
		},
		undo(current) {
			const previous = past.at(-1);
			if (!previous) return null;
			past = past.slice(0, -1);
			future = [current, ...future].slice(0, limit);
			return previous;
		},
		redo(current) {
			const next = future[0];
			if (!next) return null;
			future = future.slice(1);
			past = [...past, current].slice(-limit);
			return next;
		},
		clear() {
			past = [];
			future = [];
		},
		sizes: () => ({ past: past.length, future: future.length }),
	};
}

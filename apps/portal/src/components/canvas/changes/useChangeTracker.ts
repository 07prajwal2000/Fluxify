import { useCallback, useMemo, useRef, useState } from "react";
import {
	createChangeTracker,
	type ChangeSet,
	type ChangeTracker,
	type KnownIds,
} from "./changeTracker";

export type CanvasChanges = {
	enabled: boolean;
	/** True once anything has changed since the last load/save. */
	dirty: boolean;
	changes: ChangeSet;
	markUpserted: ChangeTracker["markUpserted"];
	markDeleted: ChangeTracker["markDeleted"];
	/** Marks a block's `data` as edited — for block settings forms. */
	markBlockData: (blockId: string) => void;
	reset: (known: KnownIds) => void;
};

const NO_IDS: KnownIds = { blocks: [], edges: [] };

/**
 * React binding for the change tracker. Marking is a ref mutation (cheap, no
 * re-render); only the dirty flag lives in state so a Save button can react.
 */
export function useChangeTracker(enabled: boolean): CanvasChanges {
	const trackerRef = useRef<ChangeTracker | null>(null);
	trackerRef.current ??= createChangeTracker(NO_IDS);
	const tracker = trackerRef.current;
	const [dirty, setDirty] = useState(false);

	const markUpserted = useCallback<ChangeTracker["markUpserted"]>(
		(kind, ids) => {
			if (!enabled) return;
			tracker.markUpserted(kind, ids);
			setDirty(tracker.size() > 0);
		},
		[enabled, tracker],
	);

	const markDeleted = useCallback<ChangeTracker["markDeleted"]>(
		(kind, ids) => {
			if (!enabled) return;
			tracker.markDeleted(kind, ids);
			setDirty(tracker.size() > 0);
		},
		[enabled, tracker],
	);

	const markBlockData = useCallback(
		(blockId: string) => markUpserted("blocks", [blockId]),
		[markUpserted],
	);

	const reset = useCallback(
		(known: KnownIds) => {
			tracker.reset(known);
			setDirty(false);
		},
		[tracker],
	);

	return useMemo(
		() => ({
			enabled,
			dirty: enabled && dirty,
			changes: tracker.changes,
			markUpserted,
			markDeleted,
			markBlockData,
			reset,
		}),
		[enabled, dirty, tracker, markUpserted, markDeleted, markBlockData, reset],
	);
}

export type ItemRow<T> = {
	type: "item";
	item: T;
	originalIndex: number;
	displayIndex: number;
	/** the drop index a row reports under the pointer */
	hitIndex: number;
	isDropTarget?: boolean;
	isPinnedSource?: boolean;
};
export type Row<T> = ItemRow<T> | { type: "placeholder"; displayIndex: number; hitIndex: number };

const plain = <T>(item: T, index: number): ItemRow<T> => ({
	type: "item",
	item,
	originalIndex: index,
	displayIndex: index,
	hitIndex: index,
});

/**
 * The rows to render, with a placeholder where the dragged item would land.
 * ponytail: pinned rows are assumed to sit at the end of the list
 */
export function displayRows<T>(
	items: T[],
	drag: { from: number; over: number } | null,
	isItemPinned?: (item: T) => boolean,
): Row<T>[] {
	if (drag === null) return items.map(plain);

	const { from, over } = drag;
	const pinned = (index: number) => !!isItemPinned && isItemPinned(items[index]);
	const others = items
		.map((item, index) => ({ item, index }))
		.filter(({ index }) => index !== from);

	if (pinned(from)) {
		// the pinned row stays put, dimmed; the placeholder shows where it will land
		const result: Row<T>[] = [];
		let slot = 0;
		for (const { item, index } of others) {
			if (slot === over) {
				result.push({ type: "placeholder", displayIndex: slot, hitIndex: slot });
				slot++;
			}
			result.push({ ...plain(item, index), displayIndex: slot, hitIndex: slot });
			slot++;
		}
		if (over >= slot) result.push({ type: "placeholder", displayIndex: slot, hitIndex: slot });
		// hovering the pin itself cancels the drop
		result.push({ ...plain(items[from], from), hitIndex: -1, isPinnedSource: true });
		return result;
	}

	if (pinned(over)) {
		// dropping onto a pinned row: nothing slides, the pinned row lights up
		return others.map(({ item, index }) => {
			if (pinned(index)) return { ...plain(item, index), isDropTarget: index === over };
			const shifted = index > from ? index - 1 : index;
			return { ...plain(item, index), displayIndex: shifted, hitIndex: shifted };
		});
	}

	const result: Row<T>[] = [];
	let next = 0;
	for (let i = 0; i < items.length; i++) {
		if (i === over) {
			result.push({ type: "placeholder", displayIndex: i, hitIndex: i });
		} else {
			const entry = others[next++];
			if (entry) result.push({ ...plain(entry.item, entry.index), displayIndex: i, hitIndex: i });
		}
	}
	return result;
}

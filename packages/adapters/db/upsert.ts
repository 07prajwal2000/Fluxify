/** insert-or-update on a unique key; `update` left out means every inserted column except `target` */
export type OnConflict = {
	target: string[];
	action: "update" | "ignore";
	update?: string[];
};

/** the columns an upsert overwrites */
export function conflictUpdateColumns(rows: object[], onConflict: OnConflict): string[] {
	if (onConflict.update) return onConflict.update;
	const columns = new Set(rows.flatMap((r) => Object.keys(r)));
	for (const c of onConflict.target) columns.delete(c);
	return [...columns];
}

/** each row's `target` values; every row needs them to be matched and read back */
export function conflictKeys(rows: Record<string, any>[], target: string[]) {
	return rows.map((row) =>
		Object.fromEntries(
			target.map((c) => {
				if (row[c] === undefined) throw new Error(`upsert: a row has no value for "${c}"`);
				return [c, row[c]];
			}),
		),
	);
}

/**
 * One upsert per row, matched on `target`: `$set` the update columns, `$setOnInsert` the rest.
 * `$eq`, never a bare value: a value like { $ne: null } from a request must not act as a query.
 */
export function mongoUpsertOps(rows: Record<string, unknown>[], onConflict: OnConflict) {
	const filters = conflictKeys(rows, onConflict.target).map((key) =>
		Object.fromEntries(Object.entries(key).map(([c, v]) => [c, { $eq: v }])),
	);
	const update = onConflict.action === "ignore" ? [] : conflictUpdateColumns(rows, onConflict);
	const ops = rows.map((row, i) => {
		const { id, _id, ...clean } = row;
		const entries = Object.entries(clean);
		const $set = Object.fromEntries(entries.filter(([c]) => update.includes(c)));
		const $setOnInsert = Object.fromEntries(entries.filter(([c]) => !update.includes(c)));
		// Mongo rejects an empty operator
		const doc = Object.entries({ $set, $setOnInsert }).filter(([, v]) => Object.keys(v).length);
		return { updateOne: { filter: filters[i], update: Object.fromEntries(doc), upsert: true } };
	});
	return { filters, ops };
}

import { type CounterOp, counterDelta, isCounterOp } from "@fluxify/sdk/integrations";
import { sql } from "kysely";

export { type CounterOp, counterDelta, isCounterOp };

/** SQL UPDATE ... SET values: a counter becomes `col + ?` */
export function sqlCounterSet(data: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(data).map(([c, v]) => [
			c,
			isCounterOp(v) ? sql`${sql.ref(c)} + ${counterDelta(c, v)}` : v,
		]),
	);
}

/** Mongo update document: counters under `$inc`, the rest under `$set`; an empty operator is left out */
export function mongoCounterUpdate(data: Record<string, unknown>) {
	const $set: Record<string, unknown> = {};
	const $inc: Record<string, number> = {};
	for (const [c, v] of Object.entries(data)) {
		if (isCounterOp(v)) $inc[c] = counterDelta(c, v);
		else $set[c] = v;
	}
	return Object.fromEntries(
		Object.entries({ $set, $inc }).filter(([, v]) => Object.keys(v).length),
	);
}

/**
 * Upsert rows with each counter replaced by its amount: a new row starts at it, as if from 0.
 * `counters` are the columns an update adds to instead of overwriting.
 */
export function splitCounters(rows: Record<string, unknown>[], target: string[]) {
	const counters = new Set(
		rows.flatMap((row) => Object.keys(row).filter((c) => isCounterOp(row[c]))),
	);
	const values = rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([c, v]) => {
				if (!counters.has(c)) return [c, v];
				if (target.includes(c)) throw new Error(`"${c}" is matched on and cannot be a counter`);
				if (!isCounterOp(v))
					throw new Error(`"${c}" is a counter in one row and a plain value in another`);
				return [c, counterDelta(c, v)];
			}),
		),
	);
	return { rows: values, counters: [...counters] };
}

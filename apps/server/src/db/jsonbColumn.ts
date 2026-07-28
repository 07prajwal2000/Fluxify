import { customType } from "drizzle-orm/pg-core";

/**
 * `jsonb` column that stores a real JSON object, not a JSON *string*.
 *
 * Drizzle's built-in `jsonb()` does `JSON.stringify(value)` in `mapToDriverValue`,
 * and the bun-sql driver serializes that string again — so rows land as a jsonb
 * *string* (`"{\"a\":1}"`). App code never noticed (drizzle `JSON.parse`s it back
 * on read), but every SQL-level operator did: `config ->> 'key'` is always NULL,
 * `||` merges into an array instead of an object, and GIN indexes are useless.
 *
 * Passing the value through untouched lets bun-sql serialize it once, correctly.
 * Column DDL is identical (`jsonb`), so swapping this in needs no migration —
 * only rows written by the old path stay double-encoded.
 */
export const jsonb = customType<{ data: any; driverData: any }>({
	dataType: () => "jsonb",
});

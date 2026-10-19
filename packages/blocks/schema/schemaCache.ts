import { createHash } from "node:crypto";
import type { z } from "zod";
import { buildZodSchema } from "./buildZodSchema";
import { ValidationSchemaZod } from "./validationSchemaZod";

/**
 * ponytail: 256 compiled schemas. A project that keeps editing its schemas
 * would otherwise grow worker memory for as long as the worker lives; an
 * evicted schema is just rebuilt on its next use. Raise it if a worker serves
 * more distinct live schemas than this (routes + programmable blocks).
 */
export const SCHEMA_CACHE_MAX = 256;
/** insertion order is recency order: a hit re-inserts, eviction takes the first key */
const cache = new Map<string, z.ZodTypeAny>();

/** JSON with object keys sorted, so key order never splits two equal definitions */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const fields = Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
		return `{${fields.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * The zod schema for a definition, built once and shared by every route and
 * block that uses an identical one; `undefined` when the definition is invalid.
 *
 * A cached schema is shared by concurrent requests, so a JS refinement must not
 * keep per-request state: it reads the request's vars from async-local storage
 * (see `validationContext`), never from a closure.
 */
export function cachedZod(def: unknown, coerce = false): z.ZodTypeAny | undefined {
	const key = `${coerce}:${createHash("sha256").update(stableJson(def)).digest("base64")}`;
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const parsed = ValidationSchemaZod.safeParse(def);
	if (!parsed.success) return undefined;
	const zod = buildZodSchema(parsed.data, coerce);
	cache.set(key, zod);
	if (cache.size > SCHEMA_CACHE_MAX) cache.delete(cache.keys().next().value as string);
	return zod;
}

export type CompiledSchema = { zod: z.ZodTypeAny; schema: unknown };

/** what a programmable block's `schema` param receives: the zod schema and the definition it came from */
export function compileSchema(def: unknown): CompiledSchema {
	const zod = cachedZod(def);
	if (!zod) throw new Error("Invalid schema definition format");
	return { zod, schema: def };
}

import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { kvAdapterFor, kvFailure } from "./schema";

/**
 * Only what both Redis and Memcached genuinely do. Everything richer that
 * Redis offers (incr, expire, ttl, hashes, lists, pub/sub) stays off the shared
 * adapter and is reached through the Raw Connection block instead — see #395.
 */
export const kvOperationSchema = z.enum(["get", "set", "delete"]);

export const kvOperationsBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		operation: kvOperationSchema.describe("operation to perform"),
		key: z.string().describe("key to operate on (supports js expression)"),
		useParam: z
			.boolean()
			.nullish()
			.describe("`set` only: store the previous block's output instead of the value field"),
		value: z
			.any()
			.nullish()
			.describe(
				"value to store; `set` only, and ignored when useParam is set. Non-strings are stored as JSON",
			),
		ttl: z
			.union([z.string(), z.number()])
			.nullish()
			.describe("`set` only: seconds until the key expires. Omit or 0 to store it without expiry"),
		parseJson: z
			.boolean()
			.nullish()
			.describe(
				"`get` only: parse the stored string as JSON. A missing key stays null; a value that is not valid JSON fails the block",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const kvOperationsAiDescription = {
	name: BlockTypes.kv_operations,
	description:
		"Reads, writes or deletes a key in a Redis/Memcached store. `get` returns the stored string or null, `set` returns true, `delete` returns true.",
	jsonSchema: JSON.stringify(z.toJSONSchema(kvOperationsBlockSchema)),
};

/** Strings go in untouched; anything else is stored as JSON. */
function serialize(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export async function runKvOperations(
	context: Context,
	connection: string,
	operation: z.infer<typeof kvOperationSchema>,
	key: string,
	value?: unknown,
	ttl?: string | number | null,
	parseJson?: boolean | null,
) {
	const adapter = kvAdapterFor(context, connection);
	try {
		if (operation === "get") {
			const stored = await adapter.get(key);
			// a missing key is null, not the string "null" — there is nothing to
			// parse, and JSON.parse(null) would hand back a misleading null anyway
			if (!parseJson || stored === null) return stored;
			// a value that is not JSON fails the block rather than silently
			// returning a string, which only surprises the next block
			return JSON.parse(stored);
		}
		if (operation === "delete") {
			await adapter.delete(key);
			return true;
		}
		// `setex` rejects a non-positive lifetime, and "no expiry" is the default
		// a blank TTL field means — so only a real number routes to it.
		const seconds = Number(ttl);
		if (Number.isFinite(seconds) && seconds > 0) {
			await adapter.setex(key, seconds, serialize(value));
		} else {
			await adapter.set(key, serialize(value));
		}
		return true;
	} catch (error) {
		kvFailure(operation, error);
	}
}

export function emitKvOperations(node: EmitNode) {
	const input = kvOperationsBlockSchema.parse(node.block.data);
	// `node.in` is read as an argument before it is assigned the result, so
	// passing it as the value is safe
	const value = input.useParam ? node.in : node.value(input.value ?? null);
	return `${node.in} = await lib.kvOperations(ctx, ${node.value(input.connection)}, ${JSON.stringify(input.operation)}, ${node.value(input.key)}, ${value}, ${node.value(input.ttl ?? null)}, ${JSON.stringify(input.parseJson ?? false)});
${node.next()}`;
}

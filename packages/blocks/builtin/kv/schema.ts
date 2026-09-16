import type { Context } from "../../baseBlock";

/** every kv block resolves its adapter the same way */
export function kvAdapterFor(context: Context, connection: string) {
	return context.kvFactory!.getKvAdapter(connection);
}

/** keeps the block's error text while preserving the real cause */
export function kvFailure(block: string, error: unknown): never {
	throw new Error(`failed to execute ${block} kv block`, { cause: error });
}

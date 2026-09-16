import z from "zod";
import { baseBlockDataSchema, Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { kvAdapterFor, kvFailure } from "./schema";

export const kvRawBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		js: z
			.string()
			.describe(
				"js code to execute (has a `kv` global holding the raw client: ioredis for Redis, the memcached client for Memcached; use its own command methods, e.g. await kv.incr('hits'))",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const kvRawAiDescription = {
	name: BlockTypes.kv_raw,
	description:
		"Runs JavaScript against the raw Redis/Memcached client, for commands the KV Operations block does not cover.",
	jsonSchema: JSON.stringify(z.toJSONSchema(kvRawBlockSchema)),
};

/**
 * `kv` is published on vars for the duration of the snippet and deleted after,
 * exactly as the native db block does it with `dbQuery`. Inlined user code
 * reaches it through the scope proxy.
 */
export async function runKvRaw(
	context: Context,
	connection: string,
	body: () => Promise<unknown>,
) {
	const adapter = kvAdapterFor(context, connection);
	const vars = context.vars as Record<string, any>;
	vars.kv = adapter.getConnection();
	try {
		return await body();
	} catch (error) {
		kvFailure("raw connection", error);
	} finally {
		delete vars.kv;
	}
}

export function emitKvRaw(node: EmitNode) {
	const input = kvRawBlockSchema.parse(node.block.data);
	const code = input.js.startsWith("js:") ? input.js.slice(3) : input.js;
	return `${node.in} = await lib.kvRaw(ctx, ${node.value(input.connection)}, async () => ${node.js(code, node.in)});
${node.next()}`;
}

import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { withGlobals } from "../snippetGlobals";
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

/** `kv` is on vars only while the snippet runs; a graph variable named `kv` is put back after */
export async function runKvRaw(context: Context, connection: string, body: () => Promise<unknown>) {
	const kv = kvAdapterFor(context, connection).getConnection();
	try {
		return await withGlobals(context.vars as Record<string, unknown>, { kv }, body);
	} catch (error) {
		kvFailure("raw connection", error);
	}
}

export function emitKvRaw(node: EmitNode) {
	const input = kvRawBlockSchema.parse(node.block.data);
	const code = input.js.startsWith("js:") ? input.js.slice(3) : input.js;
	return `${node.in} = await lib.kvRaw(ctx, ${node.value(input.connection)}, async () => ${node.js(code, node.in)});
${node.next()}`;
}

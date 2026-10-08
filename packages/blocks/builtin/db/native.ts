import { MongoAdapter, ObjectId, sessionBoundDb } from "@fluxify/adapters";
import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { withGlobals } from "../snippetGlobals";
import { adapterFor, dbFailure } from "./schema";

export const nativeDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		js: z
			.string()
			.describe(
				"js code to execute. PostgreSQL/MySQL: dbQuery(query: string, params?: unknown[]) global returning rows; use $1, $2 placeholders (MySQL also takes ?), never interpolate values. MongoDB: db global is the driver's Db (await db.collection('users').find({ age: { $gt: 18 } }).toArray()) and ObjectId builds ids; inside a transaction every collection call joins it; dbQuery(sql) throws on MongoDB",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const nativeDbAiDescription = {
	name: BlockTypes.db_native,
	description: "Executes raw SQL or database-specific commands via JavaScript.",
	jsonSchema: JSON.stringify(z.toJSONSchema(nativeDbBlockSchema)),
	output: "Whatever the code returns, e.g. the rows from dbQuery.",
	example: {
		connection: "<integration id>",
		js: "const rows = await dbQuery('SELECT id, email FROM users WHERE created_at > $1', [input.since]);\nreturn rows;",
	},
};

const MONGO_DB_QUERY = "dbQuery takes SQL; on MongoDB use db.collection(...)";

/** each call looks the adapter up again, so a snippet still running when its transaction times out is refused */
async function nativeGlobals(context: Context, connection: string) {
	const current = () => adapterFor(context, connection);
	const adapter = current();
	if (!(adapter instanceof MongoAdapter))
		return { dbQuery: (...args: Parameters<typeof adapter.raw>) => current().raw(...args) };
	const db = sessionBoundDb(await adapter.raw(), () =>
		(current() as MongoAdapter).transactionSession(),
	);
	return {
		db,
		ObjectId,
		// saved code wrote `const db = await dbQuery()`: no query still hands back db
		dbQuery: async (query?: unknown) => {
			if (query !== undefined) throw new Error(MONGO_DB_QUERY);
			return db;
		},
	};
}

export async function runNativeDb(
	context: Context,
	connection: string,
	body: () => Promise<unknown>,
) {
	const globals = await nativeGlobals(context, connection);
	try {
		return await withGlobals(context.vars as Record<string, unknown>, globals, body);
	} catch (error) {
		dbFailure("native", error);
	}
}

export function emitNativeDb(node: EmitNode) {
	const input = nativeDbBlockSchema.parse(node.block.data);
	const code = input.js.startsWith("js:") ? input.js.slice(3) : input.js;
	return `${node.in} = await lib.dbNative(ctx, ${node.value(input.connection)}, async () => ${node.js(code, node.in)});
${node.next()}`;
}

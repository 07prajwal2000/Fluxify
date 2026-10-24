import { BLOCK_TYPES } from "../blocks/blockTypes";
import { readDbBinding } from "../panel/blocks/db/conditions";
import { DB_TABLE_BLOCKS } from "./dbOutputType";

type Data = Record<string, unknown>;

/** Blocks that hand on exactly what they received, down every handle. */
export const PASS_THROUGH: ReadonlySet<string> = new Set([
	BLOCK_TYPES.entrypoint,
	BLOCK_TYPES.if,
	BLOCK_TYPES.switch,
	BLOCK_TYPES.consolelog,
	BLOCK_TYPES.cloudLogs,
	BLOCK_TYPES.httpsetheader,
	BLOCK_TYPES.httpsetcookie,
]);

/** Blocks that run a chain from their `executor` handle, then branch on its result. */
export const CHAIN_FAILURE: Record<string, string> = {
	[BLOCK_TYPES.db_transaction]: '{ reason: "rollback" | "error" | "timeout"; message: string }',
	[BLOCK_TYPES.retry]: "{ attempts: number; message: string }",
};

/** The data field a block's script lives in, when the block runs one. */
export function scriptOf(type: string, data: Data): unknown {
	switch (type) {
		case BLOCK_TYPES.jsrunner:
			return data.value;
		case BLOCK_TYPES.db_native:
		case BLOCK_TYPES.kv_raw:
			return data.js;
		// without `useJs` it maps fields instead, which has no script to read
		case BLOCK_TYPES.transformer:
			return data.useJs === true ? data.js : undefined;
		default:
			return undefined;
	}
}

/** What a block with one fixed result hands on its `source` handle, whatever it is set to. */
export function fixedOutput(type: string, data: Data): string | null {
	switch (type) {
		case BLOCK_TYPES.httprequest:
			return "{ data: any; status: number }";
		case BLOCK_TYPES.httpgetheader:
		case BLOCK_TYPES.httpgetparam:
		case BLOCK_TYPES.httpgetcookie:
			return data.mode === "multiple" ? "string[]" : "string";
		case BLOCK_TYPES.errorHandler:
			return "string";
		case BLOCK_TYPES.arrayops:
			return "any[]";
		// loops return nothing; what a round gets is the block's `executor` handle
		case BLOCK_TYPES.forloop:
		case BLOCK_TYPES.foreachloop:
			return "undefined";
		// "later" hands back the held run; the other modes pass the input on
		case BLOCK_TYPES.triggerWorkflow:
			return data.mode === "later" ? "{ id: string; runAt: string }" : null;
		default:
			return null;
	}
}

/** What one round of a loop gets as `input`. */
export function loopItem(type: string, data: Data, input: string): string {
	if (type === BLOCK_TYPES.forloop) return "number";
	// without "use parameter" it walks a list typed into the block
	if (!data.useParam || input === "any") return "any";
	return `(${input})[number]`;
}

/** Everything in a block's data that can change its output type, or null when none can. */
export function typeDependencies(node: { id: string; type?: string; data?: unknown }): unknown {
	const type = node.type ?? "";
	const data = (node.data ?? {}) as Data;
	if (DB_TABLE_BLOCKS.has(type)) {
		const { connectionId, tableName } = readDbBinding({ data });
		const { columns, joins, paging, onConflict } = data;
		return [node.id, type, connectionId, tableName, columns, joins, paging, onConflict];
	}
	if (scriptOf(type, data) !== undefined) return [node.id, type, scriptOf(type, data)];
	if (fixedOutput(type, data) !== null || type === BLOCK_TYPES.foreachloop) {
		return [node.id, type, data.mode, data.useParam];
	}
	return null;
}

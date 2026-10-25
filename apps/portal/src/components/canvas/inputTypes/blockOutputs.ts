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
		// the global `getRequestBody()` already carries the route's body schema
		case BLOCK_TYPES.httpgetrequestbody:
			return "ReturnType<typeof getRequestBody>";
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

/** `[A, B]`: one slot per row, in row order. */
export const tuple = (types: string[]) => `[${types.join(", ")}]`;

/**
 * What a literal or `js:` value stores. A `js:` value is a function body, so
 * it is typed like a script; any other text is the string itself.
 */
export async function valueType(
	raw: unknown,
	input: string,
	infer: (source: string, input: string) => Promise<string>,
): Promise<string> {
	if (typeof raw === "string") {
		if (raw.startsWith("js:")) return infer(raw.slice(3), input);
		return raw.startsWith("param:") ? "any" : "string";
	}
	return typeof raw === "number" || typeof raw === "boolean" ? typeof raw : "any";
}

/** A field map: each source key's value, under its destination key. */
export function fieldMapOutput(fieldMap: unknown, input: string): string {
	const members = new Map<string, string>();
	for (const [from, to] of Object.entries((fieldMap ?? {}) as Record<string, unknown>)) {
		if (typeof to !== "string" || !to) continue;
		members.set(to, input === "any" ? "any" : `(${input})[${JSON.stringify(from)}]`);
	}
	if (members.size === 0) return "{}";
	return `{ ${[...members].map(([to, type]) => `${JSON.stringify(to)}: ${type};`).join(" ")} }`;
}

/** KV stores are untyped: a read is `any`, a write hands its input on. */
export function kvOperationOutput(data: Data, input: string): string {
	const read = data.operation === "get";
	if (data.keepResult === true) return `{ input: ${input}; result: ${read ? "any" : "boolean"} }`;
	return read ? "any" : input;
}

/**
 * What a broker reports, every broker's fields together: one message gets its
 * receipt, a list gets `sent` and `failed`, a failure gets `error`. All
 * optional, so the editor completes whichever the user needs.
 */
export const QUEUE_RESULT = `{ topic?: string; partition?: number; offset?: string; stream?: string; seq?: number; duplicate?: boolean; queueUrl?: string; messageId?: string; sequenceNumber?: string; exchange?: string; routingKey?: string; id?: string; error?: string; sent?: { index: number; [key: string]: any }[]; failed?: { index: number; error: string }[] }`;

/** What one round of a loop gets as `input`. */
export function loopItem(type: string, data: Data, input: string): string {
	if (type === BLOCK_TYPES.forloop) return "number";
	// without "use parameter" it walks a list typed into the block
	if (!data.useParam || input === "any") return "any";
	return `(${input})[number]`;
}

/** Blocks whose output is built from their own settings, so any of them can change it. */
const BUILT_FROM_DATA: ReadonlySet<string> = new Set([
	BLOCK_TYPES.setvar,
	BLOCK_TYPES.getvar,
	BLOCK_TYPES.kv_operations,
	BLOCK_TYPES.transformer,
	BLOCK_TYPES.queue_send,
	BLOCK_TYPES.orchestrator,
	BLOCK_TYPES.foreachloop,
	BLOCK_TYPES.forloop,
]);

/** Everything in a block's data that can change its output type, or null when none can. */
export function typeDependencies(node: { id: string; type?: string; data?: unknown }): unknown {
	const type = node.type ?? "";
	const data = (node.data ?? {}) as Data;
	if (DB_TABLE_BLOCKS.has(type)) {
		const { connectionId, tableName } = readDbBinding({ data });
		const { columns, joins, paging, onConflict } = data;
		return [node.id, type, connectionId, tableName, columns, joins, paging, onConflict];
	}
	if (BUILT_FROM_DATA.has(type)) return [node.id, type, data];
	if (scriptOf(type, data) !== undefined) return [node.id, type, scriptOf(type, data)];
	if (fixedOutput(type, data) !== null) return [node.id, type, data.mode];
	return null;
}

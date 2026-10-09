import { BLOCK_TYPE_LIST, BLOCK_TYPES, type BlockType } from "./blockTypes";

/**
 * Complete, schema-valid starting data for every core block created on canvas.
 * Keep this at the creation boundary so picker, keyboard shortcuts, and future
 * insertion affordances always create the same valid block payload.
 */
export function defaultBlockData(type: BlockType): Record<string, unknown> {
	// A custom block: its input params are filled in the panel, but the engine
	// always reads an invocation mode.
	if (!BLOCK_TYPE_LIST.includes(type)) return { invoke: "sync" };
	if (type === BLOCK_TYPES.response) return { httpCode: "200" };
	if (type === BLOCK_TYPES.if) return { conditions: [] };
	if (type === BLOCK_TYPES.forloop) return { start: 0, end: 1, step: 1 };
	if (type === BLOCK_TYPES.foreachloop) return { values: [], useParam: false };
	if (type === BLOCK_TYPES.orchestrator) return { order: [], onError: "throw" };
	if (type === BLOCK_TYPES.switch) {
		return { order: [], conditions: {}, useValue: false, value: "", matches: {} };
	}
	if (type === BLOCK_TYPES.transformer) return { fieldMap: {}, useJs: false };
	if (type === BLOCK_TYPES.jsrunner) return { value: "" };
	if (type === BLOCK_TYPES.setvar) return { key: "", value: "" };
	if (type === BLOCK_TYPES.getvar) return { key: "" };
	if (type === BLOCK_TYPES.arrayops) {
		return { operation: "push", datasource: "", value: "", useParamAsInput: false };
	}
	if (type === BLOCK_TYPES.httprequest) {
		return { url: "", method: "GET", headers: {}, body: "", useParam: false };
	}
	if (type === BLOCK_TYPES.httpgetheader || type === BLOCK_TYPES.httpgetcookie) {
		return { name: "" };
	}
	if (type === BLOCK_TYPES.httpsetheader) return { name: "", value: "" };
	if (type === BLOCK_TYPES.httpgetparam) return { name: "", source: "query" };
	if (type === BLOCK_TYPES.httpsetcookie) {
		return { name: "", value: "", expiry: "", path: "/", httpOnly: false, secure: false };
	}
	if (type === BLOCK_TYPES.httpgetrequestbody || type === BLOCK_TYPES.consolelog) {
		return type === BLOCK_TYPES.consolelog ? { level: "info" } : {};
	}
	if (type === BLOCK_TYPES.cloudLogs) return { connection: "", level: "info" };
	if (type === BLOCK_TYPES.triggerWorkflow) {
		return { workflowId: "", useInput: false, data: "", mode: "now", runAt: "", scheduleId: "" };
	}
	if (
		type === BLOCK_TYPES.db_getsingle ||
		type === BLOCK_TYPES.db_exists ||
		type === BLOCK_TYPES.db_count ||
		type === BLOCK_TYPES.db_delete
	) {
		return { connection: "", tableName: "", conditions: [] };
	}
	if (type === BLOCK_TYPES.db_getall) {
		return {
			connection: "",
			tableName: "",
			conditions: [],
			joins: [],
			columns: ["*"],
			limit: 1000,
			offset: 0,
			sort: [],
		};
	}
	if (type === BLOCK_TYPES.db_insert) {
		return { connection: "", tableName: "", data: { source: "raw", value: {} }, useParam: false };
	}
	if (type === BLOCK_TYPES.db_insertbulk) {
		return {
			connection: "",
			tableName: "",
			data: { source: "raw", value: [] },
			useParam: false,
			useTransaction: true,
		};
	}
	if (type === BLOCK_TYPES.db_update) {
		return {
			connection: "",
			tableName: "",
			conditions: [],
			data: { source: "raw", value: {} },
			useParam: false,
		};
	}
	if (type === BLOCK_TYPES.db_native) return { connection: "", js: "" };
	if (type === BLOCK_TYPES.db_transaction)
		return { connection: "", executor: "", timeoutMs: "30000", retries: "0" };
	if (type === BLOCK_TYPES.db_rollback) return { message: "" };
	if (type === BLOCK_TYPES.retry)
		return { maxRetries: "3", retryType: "fixed", delayMs: "1000", maxDelayMs: "30000" };
	if (type === BLOCK_TYPES.kv_raw) return { connection: "", js: "" };
	if (type === BLOCK_TYPES.queue_send) {
		return {
			connection: "",
			mode: "simple",
			bulk: false,
			destination: "",
			useParam: false,
			payload: { source: "raw", value: {} },
			headers: {},
			options: {},
			failWhen: "all",
			js: "",
		};
	}
	if (type === BLOCK_TYPES.kv_operations) {
		return {
			connection: "",
			operation: "get",
			key: "",
			parseJson: false,
			useParam: false,
			keepResult: false,
			value: "",
			ttl: "",
		};
	}
	return {};
}

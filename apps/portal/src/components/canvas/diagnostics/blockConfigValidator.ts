import { variableNameError } from "@fluxify/blocks/variableName";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { savesOutput } from "../panel/SaveOutputField";
import type { BlockData, CanvasGraph } from "../types";
import type { BlockDiagnostic, DiagnosticSeverity } from "./types";

export const BLOCK_CONFIG_SOURCE = "block-config";

const DB_TYPES = new Set<string>([
	BLOCK_TYPES.db_getsingle,
	BLOCK_TYPES.db_getall,
	BLOCK_TYPES.db_insert,
	BLOCK_TYPES.db_insertbulk,
	BLOCK_TYPES.db_update,
	BLOCK_TYPES.db_delete,
	BLOCK_TYPES.db_native,
	BLOCK_TYPES.db_transaction,
]);
const DB_WITH_TABLE = new Set<string>([
	BLOCK_TYPES.db_getsingle,
	BLOCK_TYPES.db_getall,
	BLOCK_TYPES.db_insert,
	BLOCK_TYPES.db_insertbulk,
	BLOCK_TYPES.db_update,
	BLOCK_TYPES.db_delete,
]);
const DB_WITH_JOINS = new Set<string>([BLOCK_TYPES.db_getsingle, BLOCK_TYPES.db_getall]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
/** "return" alone is 6 chars; anything shorter can't produce a value */
const MIN_SCRIPT = 6;

/** a value, a condition side (`{ kind, value }`) or a `js:` string with nothing in it */
function isBlank(raw: unknown): boolean {
	if (raw && typeof raw === "object" && "value" in raw) return isBlank(raw.value);
	if (typeof raw === "number" || typeof raw === "boolean") return false;
	const text = typeof raw === "string" ? raw.trim() : "";
	return !(text.startsWith("js:") ? text.slice(3).trim() : text);
}

const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");
const list = (raw: unknown) => (Array.isArray(raw) ? raw : []);
const isEmptyObject = (raw: unknown) =>
	!raw || (typeof raw === "object" && Object.keys(raw).length === 0);

function isUrl(raw: string) {
	try {
		return /^https?:$/.test(new URL(raw).protocol);
	} catch {
		return false;
	}
}

type Report = (severity: DiagnosticSeverity, message: string) => void;

function checkDb(type: string, data: BlockData, report: Report) {
	if (isBlank(data.connection ?? data.integration ?? data.integrationId)) {
		report("error", "No database connection selected. Pick one in the General tab.");
	}
	if (DB_WITH_TABLE.has(type) && isBlank(data.tableName ?? data.table)) {
		report("error", "No table name. Enter the table in the General tab.");
	}
	if (type === BLOCK_TYPES.db_native && isBlank(data.js ?? data.value)) {
		report("warning", "The query script is empty, so this block does nothing.");
	}
	if (type === BLOCK_TYPES.db_transaction && isBlank(data.executor)) {
		report("warning", "The transaction script is empty, so this block does nothing.");
	}

	if (DB_WITH_TABLE.has(type) && type !== BLOCK_TYPES.db_insert && type !== BLOCK_TYPES.db_insertbulk) {
		const conditions = list(data.conditions) as Record<string, unknown>[];
		if (conditions.length === 0 && type !== BLOCK_TYPES.db_getsingle) {
			const what = type === BLOCK_TYPES.db_getall ? "reads" : type === BLOCK_TYPES.db_update ? "updates" : "deletes";
			report("warning", `No conditions, so this ${what} every row in the table. Add conditions in the Edit Conditions tab if that is not intended.`);
		}
		conditions.forEach((c, i) => {
			const empty =
				c.operator === "raw"
					? isBlank(c.raw)
					: isBlank(c.attribute ?? c.lhs) || isBlank(c.value ?? c.rhs);
			if (empty) report("warning", `Condition ${i + 1} has an empty side. Fill both sides or remove it.`);
		});
	}

	if (DB_WITH_JOINS.has(type)) {
		(list(data.joins) as Record<string, unknown>[]).forEach((j, i) => {
			if (isBlank(j.table) || isBlank(j.attribute)) {
				report("warning", `Join ${i + 1} is missing its table or column. Fill it in the Joins tab or remove it.`);
			}
		});
	}
	if (type === BLOCK_TYPES.db_getall) {
		if (isBlank(data.limit)) report("warning", "Limit is empty. Set it in the Pagination tab.");
		if (isBlank(data.offset)) report("warning", "Offset is empty. Set it in the Pagination tab, e.g. 0.");
	}

	const payload = data.data as { source?: string; value?: unknown } | undefined;
	if (payload && data.useParam !== true) {
		const empty = payload.source === "js" ? isBlank(payload.value) : isEmptyObject(payload.value);
		if (empty) report("warning", "No data to write. Fill the Data tab or turn on Use Parameter.");
	}
}

/** config problems for one block; empty when it looks runnable */
export function blockConfigIssues(type: string, data: BlockData): { severity: DiagnosticSeverity; message: string }[] {
	const out: { severity: DiagnosticSeverity; message: string }[] = [];
	const report: Report = (severity, message) => out.push({ severity, message });

	const save = data.saveAsVariable as { enabled?: boolean; name?: unknown } | undefined;
	if (save?.enabled === true && savesOutput(type, data)) {
		const error = variableNameError(text(save.name));
		if (error) report("error", `Save output to variable: ${error}.`);
	}

	if (DB_TYPES.has(type)) {
		checkDb(type, data, report);
		return out;
	}

	switch (type) {
		case BLOCK_TYPES.httprequest: {
			const url = text(data.url);
			if (!url) report("error", "URL is empty. Enter it in the General tab.");
			else if (!url.startsWith("js:") && !isUrl(url)) report("error", `"${url}" is not a valid http(s) URL.`);
			const method = String(data.method || "GET").toUpperCase();
			if (BODY_METHODS.has(method) && data.useParam !== true && isBlank(data.body)) {
				report("warning", `${method} request has an empty body. Fill the Body tab or turn on Use Params.`);
			}
			break;
		}
		case BLOCK_TYPES.setvar:
		case BLOCK_TYPES.getvar:
			if (isBlank(data.key)) report("warning", "Variable name is empty.");
			break;
		case BLOCK_TYPES.arrayops:
			if (data.useParamAsInput !== true && isBlank(data.datasource)) {
				report("warning", "No datasource. Enter the array variable or turn on Use Param.");
			}
			break;
		case BLOCK_TYPES.kv_operations:
			if (isBlank(data.connection)) report("error", "No KV connection selected. Pick one in the General tab.");
			if (isBlank(data.key)) report("warning", "Key is empty. Enter it in the Operation tab.");
			if (data.operation === "set" && data.useParam !== true && isBlank(data.value)) {
				report("warning", "Nothing to store. Enter a value or turn on Use Param.");
			}
			break;
		case BLOCK_TYPES.kv_raw:
			if (isBlank(data.connection)) report("error", "No KV connection selected. Pick one in the General tab.");
			if (text(data.js).length < MIN_SCRIPT) report("warning", "The script is empty, so this block does nothing.");
			break;
		case BLOCK_TYPES.triggerWorkflow:
			if (data.mode === "cancel") {
				if (isBlank(data.scheduleId)) report("error", "No schedule id to cancel.");
			} else if (isBlank(data.workflowId)) {
				report("error", "No workflow selected.");
			}
			break;
		case BLOCK_TYPES.if:
			if (list(data.conditions).length === 0) report("warning", "No conditions. Add at least one in the Edit Conditions tab.");
			break;
		case BLOCK_TYPES.foreachloop:
			if (data.useParam !== true && list(data.values).length === 0) {
				report("warning", "Nothing to loop over. Add items in the Data tab or turn on Use Param.");
			}
			break;
		case BLOCK_TYPES.forloop: {
			const [start, end, step] = [data.start, data.end, data.step].map((v) =>
				v === "" || v == null || typeof v === "boolean" ? NaN : Number(v),
			);
			if (![start, end, step].some(Number.isNaN)) {
				if (step === 0 || (start < end && step < 0) || (start > end && step > 0)) {
					report("warning", `This loop never ends (start ${start}, end ${end}, step ${step}). Check the step direction.`);
				}
			}
			break;
		}
		case BLOCK_TYPES.httpgetparam:
		case BLOCK_TYPES.httpgetcookie:
		case BLOCK_TYPES.httpsetcookie:
		case BLOCK_TYPES.httpgetheader:
		case BLOCK_TYPES.httpsetheader:
			if (isBlank(data.name)) report("warning", "Name is empty.");
			break;
		case BLOCK_TYPES.cloudLogs:
			if (isBlank(data.connection)) report("error", "No observability connection selected.");
			break;
		case BLOCK_TYPES.transformer:
			if (data.useJs === true) {
				if (text(data.js).length < MIN_SCRIPT) report("warning", "The script is too short to return anything.");
			} else if (isEmptyObject(data.fieldMap)) {
				report("warning", "Field map is empty. Add fields or turn on Use JS script.");
			}
			break;
		case BLOCK_TYPES.jsrunner:
			if (text(data.value ?? data.js ?? data.code).length < MIN_SCRIPT) {
				report("warning", "The script is too short to do anything.");
			}
			break;
	}
	return out;
}

/**
 * Settings mistakes on wired blocks. A block with no incoming connection never
 * runs, so it is skipped: half-built blocks stay quiet until they are used.
 */
export function validateBlockConfigs(graph: CanvasGraph): BlockDiagnostic[] {
	const wired = new Set(graph.edges.map((e) => e.to));
	const diagnostics: BlockDiagnostic[] = [];
	for (const block of graph.blocks) {
		if (!wired.has(block.id)) continue;
		for (const issue of blockConfigIssues(block.type, block.data ?? {})) {
			diagnostics.push({ blockId: block.id, source: BLOCK_CONFIG_SOURCE, ...issue });
		}
		if (
			block.type === BLOCK_TYPES.orchestrator &&
			!graph.edges.some((e) => e.from === block.id && e.fromHandle.endsWith("orchestrate"))
		) {
			diagnostics.push({
				blockId: block.id,
				severity: "info",
				message: "No branches connected. Connect blocks to the orchestrate handle.",
				source: BLOCK_CONFIG_SOURCE,
			});
		}
	}
	return diagnostics;
}

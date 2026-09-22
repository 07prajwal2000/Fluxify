import { hoistImports } from "@fluxify/blocks/imports";
import { variableNameError } from "@fluxify/blocks/variableName";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { savesOutput } from "../panel/SaveOutputField";
import type { BlockData, CanvasGraph } from "../types";
import { dbConditionIssues, isBlank } from "./dbConditionIssues";
import type { BlockDiagnostic, DiagnosticSeverity } from "./types";

export const BLOCK_CONFIG_SOURCE = "block-config";

const DB_TYPES = new Set<string>([
	BLOCK_TYPES.db_getsingle,
	BLOCK_TYPES.db_exists,
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
	BLOCK_TYPES.db_exists,
	BLOCK_TYPES.db_getall,
	BLOCK_TYPES.db_insert,
	BLOCK_TYPES.db_insertbulk,
	BLOCK_TYPES.db_update,
	BLOCK_TYPES.db_delete,
]);
const DB_WITH_JOINS = new Set<string>([
	BLOCK_TYPES.db_getsingle,
	BLOCK_TYPES.db_exists,
	BLOCK_TYPES.db_getall,
]);
/** what a condition-less db block does to "every row" — getsingle is exempt */
const NO_CONDITION_VERB: Record<string, string> = {
	[BLOCK_TYPES.db_getall]: "reads",
	[BLOCK_TYPES.db_exists]: "matches",
	[BLOCK_TYPES.db_update]: "updates",
	[BLOCK_TYPES.db_delete]: "deletes",
};
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
/** a script block's code field and the tab it is edited in */
const SCRIPTS: Record<string, { key: string; tab: string }> = {
	[BLOCK_TYPES.jsrunner]: { key: "value", tab: "General" },
	[BLOCK_TYPES.transformer]: { key: "js", tab: "Custom JavaScript" },
	[BLOCK_TYPES.kv_raw]: { key: "js", tab: "Code" },
	[BLOCK_TYPES.db_native]: { key: "js", tab: "Code" },
};

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

type Report = (severity: DiagnosticSeverity, message: string, tab?: string) => void;
export type BlockConfigIssue = { severity: DiagnosticSeverity; message: string; tab?: string };

// user code runs as an async function body on the server, so parse it as one
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => unknown;
const parsed = new Map<string, string | null>();

/** the parse error of a script, or null. Cached: this runs on every keystroke */
function syntaxError(code: string): string | null {
	const hit = parsed.get(code);
	if (hit !== undefined) return hit;
	let error: string | null = null;
	try {
		new AsyncFunction("input", "params", hoistImports(code).code);
	} catch (e) {
		// EvalError = the page forbids eval; that says nothing about the script
		if (!(e instanceof EvalError)) error = e instanceof Error ? e.message : String(e);
	}
	// ponytail: drops everything when full, an LRU if big canvases thrash it
	if (parsed.size >= 500) parsed.clear();
	parsed.set(code, error);
	return error;
}

// ponytail: a "return" inside a string or comment counts too; parse if that misleads
const HAS_RETURN = /(^|[^\w$.])return(?![\w$])/;

function checkScript(raw: unknown, where: string, report: Report, tab?: string) {
	const code = text(raw).replace(/^js:/, "");
	if (!code.trim()) return report("warning", `${where} is empty, so it does nothing.`, tab);
	const error = syntaxError(code);
	if (error) report("error", `${where} has a syntax error: ${error}`, tab);
	else if (!HAS_RETURN.test(code))
		report("warning", `${where} has no return, so it gives back nothing.`, tab);
}

/** calls `visit` for every `js:` string, with the top-level field it sits in */
function eachInlineJs(
	data: BlockData,
	skip: Set<string>,
	visit: (field: string, code: string) => void,
) {
	const walk = (value: unknown, field: string) => {
		if (typeof value === "string") {
			if (value.startsWith("js:")) visit(field, value);
		} else if (value && typeof value === "object") {
			for (const item of Object.values(value)) walk(item, field);
		}
	};
	for (const [field, value] of Object.entries(data)) if (!skip.has(field)) walk(value, field);
}

function checkDb(type: string, data: BlockData, report: Report) {
	if (isBlank(data.connection ?? data.integration ?? data.integrationId)) {
		report("error", "No database connection selected. Pick one in the General tab.", "General");
	}
	if (DB_WITH_TABLE.has(type) && isBlank(data.tableName ?? data.table)) {
		report("error", "No table name. Enter the table in the General tab.", "General");
	}
	if (type === BLOCK_TYPES.db_transaction && isBlank(data.executor)) {
		report("warning", "The transaction script is empty, so this block does nothing.");
	}

	if (
		DB_WITH_TABLE.has(type) &&
		type !== BLOCK_TYPES.db_insert &&
		type !== BLOCK_TYPES.db_insertbulk
	) {
		const conditions = list(data.conditions) as Record<string, unknown>[];
		const what = NO_CONDITION_VERB[type];
		if (conditions.length === 0 && what) {
			report(
				"warning",
				`No conditions, so this ${what} every row in the table. Add conditions in the Edit Conditions tab if that is not intended.`,
				"Edit Conditions",
			);
		}
		conditions.forEach((c, i) => {
			for (const [severity, message] of dbConditionIssues(c, i))
				report(severity, message, "Edit Conditions");
		});
	}

	if (DB_WITH_JOINS.has(type)) {
		(list(data.joins) as Record<string, unknown>[]).forEach((j, i) => {
			if (isBlank(j.table) || isBlank(j.attribute)) {
				report(
					"warning",
					`Join ${i + 1} is missing its table or column. Fill it in the Joins tab or remove it.`,
					"Joins",
				);
			}
		});
	}
	if (type === BLOCK_TYPES.db_getall) {
		if (isBlank(data.limit))
			report("warning", "Limit is empty. Set it in the Pagination tab.", "Pagination");
		if (isBlank(data.offset))
			report("warning", "Offset is empty. Set it in the Pagination tab, e.g. 0.", "Pagination");
	}

	const payload = data.data as { source?: string; value?: unknown } | undefined;
	if (payload && data.useParam !== true) {
		const empty = payload.source === "js" ? isBlank(payload.value) : isEmptyObject(payload.value);
		if (empty) {
			const tab = type === BLOCK_TYPES.db_update ? "Data to Update" : "Data to Insert";
			report("warning", `No data to write. Fill the ${tab} tab or turn on Use Parameter.`, tab);
		}
	}
}

/** config problems for one block; empty when it looks runnable */
export function blockConfigIssues(type: string, data: BlockData): BlockConfigIssue[] {
	const out: BlockConfigIssue[] = [];
	const report: Report = (severity, message, tab) => {
		out.push(tab ? { severity, message, tab } : { severity, message });
	};

	const save = data.saveAsVariable as { enabled?: boolean; name?: unknown } | undefined;
	if (save?.enabled === true && savesOutput(type, data)) {
		const error = variableNameError(text(save.name));
		if (error) report("error", `Save output to variable: ${error}.`, "General");
	}

	// the script field, plus every inline `js:` value the block holds
	const script = SCRIPTS[type];
	const skip = new Set<string>();
	if (script) {
		skip.add(script.key);
		if (type !== BLOCK_TYPES.transformer || data.useJs === true) {
			checkScript(data[script.key], "The script", report, script.tab);
		}
	}
	eachInlineJs(data, skip, (field, code) => {
		if (code.slice(3).trim()) checkScript(code, `The script in "${field}"`, report);
	});

	if (DB_TYPES.has(type)) {
		checkDb(type, data, report);
		return out;
	}

	switch (type) {
		case BLOCK_TYPES.httprequest: {
			const url = text(data.url);
			if (!url) report("error", "URL is empty. Enter it in the General tab.", "General");
			else if (!url.startsWith("js:") && !isUrl(url))
				report("error", `"${url}" is not a valid http(s) URL.`, "General");
			const method = String(data.method || "GET").toUpperCase();
			if (BODY_METHODS.has(method) && data.useParam !== true && isBlank(data.body)) {
				report(
					"warning",
					`${method} request has an empty body. Fill the Body tab or turn on Use Params.`,
					"Body",
				);
			}
			break;
		}
		case BLOCK_TYPES.setvar:
		case BLOCK_TYPES.getvar:
			if (isBlank(data.key)) report("warning", "Variable name is empty.");
			break;
		case BLOCK_TYPES.arrayops:
			if (data.useParamAsInput !== true && isBlank(data.datasource)) {
				report(
					"warning",
					"No datasource. Enter the array variable or turn on Use Param.",
					"General",
				);
			}
			break;
		case BLOCK_TYPES.kv_operations:
			if (isBlank(data.connection))
				report("error", "No KV connection selected. Pick one in the General tab.", "General");
			if (isBlank(data.key))
				report("warning", "Key is empty. Enter it in the Operation tab.", "Operation");
			if (data.operation === "set" && data.useParam !== true && isBlank(data.value)) {
				report("warning", "Nothing to store. Enter a value or turn on Use Param.", "Operation");
			}
			break;
		case BLOCK_TYPES.kv_raw:
			if (isBlank(data.connection))
				report("error", "No KV connection selected. Pick one in the General tab.", "General");
			break;
		case BLOCK_TYPES.triggerWorkflow:
			if (data.mode === "cancel") {
				if (isBlank(data.scheduleId)) report("error", "No schedule id to cancel.");
			} else if (isBlank(data.workflowId)) {
				report("error", "No workflow selected.");
			}
			break;
		case BLOCK_TYPES.if:
			if (list(data.conditions).length === 0)
				report(
					"warning",
					"No conditions. Add at least one in the Edit Conditions tab.",
					"Edit Conditions",
				);
			break;
		case BLOCK_TYPES.foreachloop:
			if (data.useParam !== true && list(data.values).length === 0) {
				report(
					"warning",
					"Nothing to loop over. Add items in the Data tab or turn on Use Param.",
					"Data",
				);
			}
			break;
		case BLOCK_TYPES.forloop: {
			const [start, end, step] = [data.start, data.end, data.step].map((v) =>
				v === "" || v == null || typeof v === "boolean" ? NaN : Number(v),
			);
			if (![start, end, step].some(Number.isNaN)) {
				if (step === 0 || (start < end && step < 0) || (start > end && step > 0)) {
					report(
						"warning",
						`This loop never ends (start ${start}, end ${end}, step ${step}). Check the step direction.`,
					);
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
			if (data.useJs !== true && isEmptyObject(data.fieldMap)) {
				report("warning", "Field map is empty. Add fields or turn on Use JS script.", "Field Map");
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

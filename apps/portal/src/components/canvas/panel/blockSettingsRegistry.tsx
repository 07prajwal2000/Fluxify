import type { ReactNode } from "react";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { BlockNode } from "../types";
import { arrayOpsSettings } from "./blocks/ArrayOpsSettings";
import { cloudLogSettings } from "./blocks/CloudLogSettings";
import { consoleLogSettings } from "./blocks/ConsoleLogSettings";
import { customBlockSettings } from "./blocks/CustomBlockSettings";
import { deleteDbSettings } from "./blocks/db/DeleteDbSettings";
import { getAllDbSettings } from "./blocks/db/GetAllDbSettings";
import { countDbSettings, getSingleDbSettings } from "./blocks/db/GetSingleDbSettings";
import { insertBulkDbSettings } from "./blocks/db/InsertBulkDbSettings";
import { insertDbSettings } from "./blocks/db/InsertDbSettings";
import { nativeDbSettings } from "./blocks/db/NativeDbSettings";
import { rollbackDbSettings } from "./blocks/db/RollbackDbSettings";
import { transactionDbSettings } from "./blocks/db/TransactionDbSettings";
import { updateDbSettings } from "./blocks/db/UpdateDbSettings";
import { foreachLoopSettings } from "./blocks/ForeachLoopSettings";
import { forLoopSettings } from "./blocks/ForLoopSettings";
import { getCookieSettings } from "./blocks/GetCookieSettings";
import { getHeaderSettings } from "./blocks/GetHeaderSettings";
import { getParamSettings } from "./blocks/GetParamSettings";
import { getVarSettings } from "./blocks/GetVarSettings";
import { httpRequestSettings } from "./blocks/HttpRequestSettings";
import { ifSettings } from "./blocks/IfSettings";
import { jsRunnerSettings } from "./blocks/JsRunnerSettings";
import { kvOperationsSettings } from "./blocks/kv/KvOperationsSettings";
import { kvRawSettings } from "./blocks/kv/KvRawSettings";
import { orchestratorSettings } from "./blocks/OrchestratorSettings";
import { responseSettings } from "./blocks/ResponseSettings";
import { setCookieSettings } from "./blocks/SetCookieSettings";
import { setHeaderSettings } from "./blocks/SetHeaderSettings";
import { setVarSettings } from "./blocks/SetVarSettings";
import { switchSettings } from "./blocks/SwitchSettings";
import { transformerSettings } from "./blocks/TransformerSettings";
import { triggerWorkflowSettings } from "./blocks/TriggerWorkflowSettings";

/**
 * Extra settings tabs per block type. A block returns
 * `BlockSettings.TabHead` elements; everything else (the General tab, the tab
 * chrome) comes from `BlockSettings`. Blocks missing here get General only.
 */
export type BlockTabs = (block: BlockNode) => ReactNode;

export const BLOCK_SETTINGS_TABS: Record<string, BlockTabs> = {
	[BLOCK_TYPES.if]: ifSettings,
	[BLOCK_TYPES.response]: responseSettings,
	[BLOCK_TYPES.getvar]: getVarSettings,
	[BLOCK_TYPES.setvar]: setVarSettings,
	[BLOCK_TYPES.transformer]: transformerSettings,
	[BLOCK_TYPES.jsrunner]: jsRunnerSettings,
	[BLOCK_TYPES.arrayops]: arrayOpsSettings,
	[BLOCK_TYPES.forloop]: forLoopSettings,
	[BLOCK_TYPES.foreachloop]: foreachLoopSettings,
	[BLOCK_TYPES.orchestrator]: orchestratorSettings,
	[BLOCK_TYPES.switch]: switchSettings,
	[BLOCK_TYPES.httpgetcookie]: getCookieSettings,
	[BLOCK_TYPES.httpgetheader]: getHeaderSettings,
	[BLOCK_TYPES.httpsetcookie]: setCookieSettings,
	[BLOCK_TYPES.httpsetheader]: setHeaderSettings,
	[BLOCK_TYPES.httpgetparam]: getParamSettings,
	[BLOCK_TYPES.httprequest]: httpRequestSettings,
	[BLOCK_TYPES.consolelog]: consoleLogSettings,
	[BLOCK_TYPES.cloudLogs]: cloudLogSettings,
	[BLOCK_TYPES.triggerWorkflow]: triggerWorkflowSettings,
	[BLOCK_TYPES.db_getsingle]: getSingleDbSettings,
	[BLOCK_TYPES.db_exists]: getSingleDbSettings,
	[BLOCK_TYPES.db_count]: countDbSettings,
	[BLOCK_TYPES.db_getall]: getAllDbSettings,
	[BLOCK_TYPES.db_delete]: deleteDbSettings,
	[BLOCK_TYPES.db_insert]: insertDbSettings,
	[BLOCK_TYPES.db_insertbulk]: insertBulkDbSettings,
	[BLOCK_TYPES.db_update]: updateDbSettings,
	[BLOCK_TYPES.db_transaction]: transactionDbSettings,
	[BLOCK_TYPES.db_rollback]: rollbackDbSettings,
	[BLOCK_TYPES.db_native]: nativeDbSettings,
	[BLOCK_TYPES.kv_raw]: kvRawSettings,
	[BLOCK_TYPES.kv_operations]: kvOperationsSettings,
};

const NO_EXTRA_TABS_BUILTIN = new Set<string>([
	BLOCK_TYPES.entrypoint,
	BLOCK_TYPES.errorHandler,
	BLOCK_TYPES.httpgetrequestbody,
	BLOCK_TYPES.stickynote,
]);

export function blockSettingsTabs(type: string | undefined): BlockTabs | undefined {
	if (!type || NO_EXTRA_TABS_BUILTIN.has(type)) return undefined;
	const builtinTabs = BLOCK_SETTINGS_TABS[type];
	if (builtinTabs) return builtinTabs;
	return customBlockSettings;
}

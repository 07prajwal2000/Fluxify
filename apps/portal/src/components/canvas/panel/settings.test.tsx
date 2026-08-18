import { expect, test } from "bun:test";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { BlockSettings, GENERAL_TAB, splitTabs } from "./BlockSettings";
import { blockSettingsTabs } from "./blockSettingsRegistry";
import type { BlockNode } from "../types";
import {
	CLOSE_DELTA_THRESHOLD,
	CLOSE_WIDTH_THRESHOLD,
	getStoredPanelWidth,
	setStoredPanelWidth,
} from "./useBlockPanelResize";

// bun has no DOM storage; the helpers only need get/setItem.
const store = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
	key: (i: number) => [...store.keys()][i] ?? null,
	get length() {
		return store.size;
	},
} as Storage;

const { TabHead } = BlockSettings;

test("declared tabs become tabs, General ones are folded into the built-in tab", () => {
	const { generalExtras, blockTabs } = splitTabs([
		<TabHead key="g" name={GENERAL_TAB}>
			<span>extra</span>
		</TabHead>,
		<TabHead key="r" name="Request">
			<span>url</span>
		</TabHead>,
		<span key="stray">ignored</span>,
	]);

	expect(generalExtras).toHaveLength(1);
	expect(blockTabs.map((tab) => tab.props.name)).toEqual(["Request"]);
});

test("a block with no tabs still gets General only", () => {
	const { generalExtras, blockTabs } = splitTabs(undefined);
	expect(generalExtras).toHaveLength(0);
	expect(blockTabs).toHaveLength(0);
});

test("getvar, setvar, transformer, arrayops, forloop, and foreachloop blocks have registered settings tabs", () => {
	const dummyGetVarBlock: BlockNode = {
		id: "getvar-1",
		type: BLOCK_TYPES.getvar,
		position: { x: 0, y: 0 },
		data: { key: "myVar" },
	};
	const dummySetVarBlock: BlockNode = {
		id: "setvar-1",
		type: BLOCK_TYPES.setvar,
		position: { x: 0, y: 0 },
		data: { key: "myVar", value: "js:123" },
	};
	const dummyTransformerBlock: BlockNode = {
		id: "transformer-1",
		type: BLOCK_TYPES.transformer,
		position: { x: 0, y: 0 },
		data: { useJs: false, fieldMap: { a: "b" } },
	};
	const dummyArrayOpsPushBlock: BlockNode = {
		id: "arrayops-push",
		type: BLOCK_TYPES.arrayops,
		position: { x: 0, y: 0 },
		data: { datasource: "items", operation: "push", useParamAsInput: false, value: "123" },
	};
	const dummyArrayOpsFilterBlock: BlockNode = {
		id: "arrayops-filter",
		type: BLOCK_TYPES.arrayops,
		position: { x: 0, y: 0 },
		data: { datasource: "items", operation: "filter", filterConditions: [{ variable: "input.id", operator: "equal", value: "1" }] },
	};
	const dummyArrayOpsPopBlock: BlockNode = {
		id: "arrayops-pop",
		type: BLOCK_TYPES.arrayops,
		position: { x: 0, y: 0 },
		data: { datasource: "items", operation: "pop" },
	};
	const dummyForLoopBlock: BlockNode = {
		id: "forloop-1",
		type: BLOCK_TYPES.forloop,
		position: { x: 0, y: 0 },
		data: { start: 1, end: 10, step: 1 },
	};
	const dummyForeachLoopBlock: BlockNode = {
		id: "foreachloop-1",
		type: BLOCK_TYPES.foreachloop,
		position: { x: 0, y: 0 },
		data: { useParam: false, values: ["a", "b"] },
	};
	const dummyForeachLoopParamBlock: BlockNode = {
		id: "foreachloop-2",
		type: BLOCK_TYPES.foreachloop,
		position: { x: 0, y: 0 },
		data: { useParam: true, values: ["a", "b"] },
	};

	const dummyHttpGetCookieBlock: BlockNode = {
		id: "getcookie-1",
		type: BLOCK_TYPES.httpgetcookie,
		position: { x: 0, y: 0 },
		data: { name: "session_id" },
	};
	const dummyHttpGetHeaderBlock: BlockNode = {
		id: "getheader-1",
		type: BLOCK_TYPES.httpgetheader,
		position: { x: 0, y: 0 },
		data: { name: "Authorization" },
	};
	const dummyHttpGetParamBlock: BlockNode = {
		id: "getparam-1",
		type: BLOCK_TYPES.httpgetparam,
		position: { x: 0, y: 0 },
		data: { source: "query", name: "page" },
	};
	const dummyHttpRequestBlock: BlockNode = {
		id: "httprequest-1",
		type: BLOCK_TYPES.httprequest,
		position: { x: 0, y: 0 },
		data: { method: "POST", url: "https://api.example.com", headers: { "Content-Type": "application/json" }, body: "{}", useParam: false },
	};
	const dummyHttpSetCookieBlock: BlockNode = {
		id: "setcookie-1",
		type: BLOCK_TYPES.httpsetcookie,
		position: { x: 0, y: 0 },
		data: { name: "session", value: "abc", domain: "example.com", path: "/", expiry: "2026-12-31", httpOnly: true, secure: true, samesite: "Lax" },
	};
	const dummyHttpSetHeaderBlock: BlockNode = {
		id: "setheader-1",
		type: BLOCK_TYPES.httpsetheader,
		position: { x: 0, y: 0 },
		data: { name: "Authorization", value: "Bearer token" },
	};
	const dummyConsoleLogBlock: BlockNode = {
		id: "consolelog-1",
		type: BLOCK_TYPES.consolelog,
		position: { x: 0, y: 0 },
		data: { level: "info", message: "Hello" },
	};
	const dummyCloudLogBlock: BlockNode = {
		id: "cloudlog-1",
		type: BLOCK_TYPES.cloudLogs,
		position: { x: 0, y: 0 },
		data: { connection: "conn-1", level: "error", message: "Error msg" },
	};
	const dummyGetSingleDbBlock: BlockNode = {
		id: "getsingle-1",
		type: BLOCK_TYPES.db_getsingle,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			columns: ["id", "name", "email"],
			joins: [{ type: "left", table: "orders", attribute: "users.id = orders.user_id" }],
			conditions: [{ attribute: "status", value: "active", operator: "equal_to", chain: "and" }],
		},
	};
	const dummyGetAllDbBlock: BlockNode = {
		id: "getall-1",
		type: BLOCK_TYPES.db_getall,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			limit: 100,
			offset: 10,
			sort: { attribute: "created_at", direction: "desc" },
			columns: ["id", "name", "email"],
			joins: [{ type: "left", table: "orders", attribute: "users.id = orders.user_id" }],
			conditions: [{ attribute: "status", value: "active", operator: "equal_to", chain: "and" }],
		},
	};
	const dummyDeleteDbBlock: BlockNode = {
		id: "delete-1",
		type: BLOCK_TYPES.db_delete,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			conditions: [{ attribute: "status", value: "inactive", operator: "equal_to", chain: "and" }],
		},
	};
	const dummyInsertDbBlock: BlockNode = {
		id: "insert-1",
		type: BLOCK_TYPES.db_insert,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: false,
			data: {
				source: "raw",
				value: { name: "Alice", email: "alice@example.com" },
			},
		},
	};
	const dummyInsertDbParamBlock: BlockNode = {
		id: "insert-2",
		type: BLOCK_TYPES.db_insert,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: true,
		},
	};
	const dummyInsertBulkDbBlock: BlockNode = {
		id: "insertbulk-1",
		type: BLOCK_TYPES.db_insertbulk,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: false,
			data: {
				source: "raw",
				value: [{ name: "Alice" }, { name: "Bob" }],
			},
		},
	};
	const dummyInsertBulkDbParamBlock: BlockNode = {
		id: "insertbulk-2",
		type: BLOCK_TYPES.db_insertbulk,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: true,
		},
	};
	const dummyUpdateDbBlock: BlockNode = {
		id: "update-1",
		type: BLOCK_TYPES.db_update,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: false,
			data: {
				source: "raw",
				value: { status: "active" },
			},
			conditions: [{ attribute: "id", value: "123", operator: "equal_to", chain: "and" }],
		},
	};
	const dummyUpdateDbParamBlock: BlockNode = {
		id: "update-2",
		type: BLOCK_TYPES.db_update,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			tableName: "users",
			useParam: true,
			conditions: [{ attribute: "id", value: "123", operator: "equal_to", chain: "and" }],
		},
	};
	const dummyTransactionDbBlock: BlockNode = {
		id: "tx-1",
		type: BLOCK_TYPES.db_transaction,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
		},
	};
	const dummyNativeDbBlock: BlockNode = {
		id: "native-1",
		type: BLOCK_TYPES.db_native,
		position: { x: 0, y: 0 },
		data: {
			connection: "db-1",
			js: "return await dbQuery('SELECT 1');",
		},
	};

	const getVarTabs = blockSettingsTabs(dummyGetVarBlock.type);
	const setVarTabs = blockSettingsTabs(dummySetVarBlock.type);
	const transformerTabs = blockSettingsTabs(dummyTransformerBlock.type);
	const arrayOpsTabs = blockSettingsTabs(dummyArrayOpsPushBlock.type);
	const forLoopTabs = blockSettingsTabs(dummyForLoopBlock.type);
	const foreachLoopTabs = blockSettingsTabs(dummyForeachLoopBlock.type);
	const getCookieTabs = blockSettingsTabs(dummyHttpGetCookieBlock.type);
	const getHeaderTabs = blockSettingsTabs(dummyHttpGetHeaderBlock.type);
	const setCookieTabs = blockSettingsTabs(dummyHttpSetCookieBlock.type);
	const setHeaderTabs = blockSettingsTabs(dummyHttpSetHeaderBlock.type);
	const getParamTabs = blockSettingsTabs(dummyHttpGetParamBlock.type);
	const httpRequestTabs = blockSettingsTabs(dummyHttpRequestBlock.type);
	const consoleLogTabs = blockSettingsTabs(dummyConsoleLogBlock.type);
	const cloudLogTabs = blockSettingsTabs(dummyCloudLogBlock.type);
	const getSingleDbTabs = blockSettingsTabs(dummyGetSingleDbBlock.type);
	const getAllDbTabs = blockSettingsTabs(dummyGetAllDbBlock.type);
	const deleteDbTabs = blockSettingsTabs(dummyDeleteDbBlock.type);
	const insertDbTabs = blockSettingsTabs(dummyInsertDbBlock.type);
	const insertBulkDbTabs = blockSettingsTabs(dummyInsertBulkDbBlock.type);
	const updateDbTabs = blockSettingsTabs(dummyUpdateDbBlock.type);
	const transactionDbTabs = blockSettingsTabs(dummyTransactionDbBlock.type);
	const nativeDbTabs = blockSettingsTabs(dummyNativeDbBlock.type);

	expect(getVarTabs).toBeDefined();
	expect(setVarTabs).toBeDefined();
	expect(transformerTabs).toBeDefined();
	expect(arrayOpsTabs).toBeDefined();
	expect(forLoopTabs).toBeDefined();
	expect(foreachLoopTabs).toBeDefined();
	expect(getCookieTabs).toBeDefined();
	expect(getHeaderTabs).toBeDefined();
	expect(setCookieTabs).toBeDefined();
	expect(setHeaderTabs).toBeDefined();
	expect(getParamTabs).toBeDefined();
	expect(httpRequestTabs).toBeDefined();
	expect(consoleLogTabs).toBeDefined();
	expect(cloudLogTabs).toBeDefined();
	expect(getSingleDbTabs).toBeDefined();
	expect(getAllDbTabs).toBeDefined();
	expect(deleteDbTabs).toBeDefined();
	expect(insertDbTabs).toBeDefined();
	expect(insertBulkDbTabs).toBeDefined();
	expect(updateDbTabs).toBeDefined();
	expect(transactionDbTabs).toBeDefined();
	expect(nativeDbTabs).toBeDefined();

	const transactionDbResult = splitTabs(transactionDbTabs!(dummyTransactionDbBlock));
	expect(transactionDbResult.generalExtras).toHaveLength(1);
	expect(transactionDbResult.blockTabs).toHaveLength(0);

	const nativeDbResult = splitTabs(nativeDbTabs!(dummyNativeDbBlock));
	expect(nativeDbResult.generalExtras).toHaveLength(1);
	expect(nativeDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Code",
	]);

	const updateDbResult = splitTabs(updateDbTabs!(dummyUpdateDbBlock));
	expect(updateDbResult.generalExtras).toHaveLength(1);
	expect(updateDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Data to Update",
		"Edit Conditions",
	]);

	const updateDbParamResult = splitTabs(updateDbTabs!(dummyUpdateDbParamBlock));
	expect(updateDbParamResult.generalExtras).toHaveLength(1);
	expect(updateDbParamResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Edit Conditions",
	]);

	const insertBulkDbResult = splitTabs(insertBulkDbTabs!(dummyInsertBulkDbBlock));
	expect(insertBulkDbResult.generalExtras).toHaveLength(1);
	expect(insertBulkDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Data to Insert",
	]);

	const insertBulkDbParamResult = splitTabs(insertBulkDbTabs!(dummyInsertBulkDbParamBlock));
	expect(insertBulkDbParamResult.generalExtras).toHaveLength(1);
	expect(insertBulkDbParamResult.blockTabs).toHaveLength(0);

	const insertDbResult = splitTabs(insertDbTabs!(dummyInsertDbBlock));
	expect(insertDbResult.generalExtras).toHaveLength(1);
	expect(insertDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Data to Insert",
	]);

	const insertDbParamResult = splitTabs(insertDbTabs!(dummyInsertDbParamBlock));
	expect(insertDbParamResult.generalExtras).toHaveLength(1);
	expect(insertDbParamResult.blockTabs).toHaveLength(0);

	const deleteDbResult = splitTabs(deleteDbTabs!(dummyDeleteDbBlock));
	expect(deleteDbResult.generalExtras).toHaveLength(1);
	expect(deleteDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Edit Conditions",
	]);

	const getSingleDbResult = splitTabs(getSingleDbTabs!(dummyGetSingleDbBlock));
	expect(getSingleDbResult.generalExtras).toHaveLength(1);
	expect(getSingleDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Columns",
		"Joins",
		"Edit Conditions",
	]);

	const getAllDbResult = splitTabs(getAllDbTabs!(dummyGetAllDbBlock));
	expect(getAllDbResult.generalExtras).toHaveLength(1);
	expect(getAllDbResult.blockTabs.map((tab) => tab.props.name)).toEqual([
		"Pagination",
		"Columns",
		"Joins",
		"Edit Conditions",
	]);

	const getVarResult = splitTabs(getVarTabs!(dummyGetVarBlock));
	expect(getVarResult.generalExtras).toHaveLength(1);

	const getCookieResult = splitTabs(getCookieTabs!(dummyHttpGetCookieBlock));
	expect(getCookieResult.generalExtras).toHaveLength(1);
	expect(getCookieResult.blockTabs).toHaveLength(0);

	const setCookieResult = splitTabs(setCookieTabs!(dummyHttpSetCookieBlock));
	expect(setCookieResult.generalExtras).toHaveLength(1);
	expect(setCookieResult.blockTabs).toHaveLength(2);
	expect((setCookieResult.blockTabs[0]?.props as { name?: string }).name).toBe("Scope");
	expect((setCookieResult.blockTabs[1]?.props as { name?: string }).name).toBe("Security");

	const getHeaderResult = splitTabs(getHeaderTabs!(dummyHttpGetHeaderBlock));
	expect(getHeaderResult.generalExtras).toHaveLength(1);
	expect(getHeaderResult.blockTabs).toHaveLength(0);

	const setHeaderResult = splitTabs(setHeaderTabs!(dummyHttpSetHeaderBlock));
	expect(setHeaderResult.generalExtras).toHaveLength(1);
	expect(setHeaderResult.blockTabs).toHaveLength(0);

	const consoleLogResult = splitTabs(consoleLogTabs!(dummyConsoleLogBlock));
	expect(consoleLogResult.generalExtras).toHaveLength(1);
	expect(consoleLogResult.blockTabs).toHaveLength(0);

	const cloudLogResult = splitTabs(cloudLogTabs!(dummyCloudLogBlock));
	expect(cloudLogResult.generalExtras).toHaveLength(1);
	expect(cloudLogResult.blockTabs).toHaveLength(0);

	const getParamResult = splitTabs(getParamTabs!(dummyHttpGetParamBlock));
	expect(getParamResult.generalExtras).toHaveLength(1);
	expect(getParamResult.blockTabs).toHaveLength(0);

	const httpRequestResult = splitTabs(httpRequestTabs!(dummyHttpRequestBlock));
	expect(httpRequestResult.generalExtras).toHaveLength(1);
	expect(httpRequestResult.blockTabs).toHaveLength(2);
	expect((httpRequestResult.blockTabs[0]?.props as { name?: string }).name).toBe("Headers");
	expect((httpRequestResult.blockTabs[1]?.props as { name?: string }).name).toBe("Body");

	const dummyHttpGetRequestBlock: BlockNode = {
		id: "httprequest-2",
		type: BLOCK_TYPES.httprequest,
		position: { x: 0, y: 0 },
		data: { method: "GET", url: "https://api.example.com" },
	};
	const httpGetResult = splitTabs(httpRequestTabs!(dummyHttpGetRequestBlock));
	expect(httpGetResult.generalExtras).toHaveLength(1);
	expect(httpGetResult.blockTabs).toHaveLength(1);
	expect((httpGetResult.blockTabs[0]?.props as { name?: string }).name).toBe("Headers");

	const setVarResult = splitTabs(setVarTabs!(dummySetVarBlock));
	expect(setVarResult.generalExtras).toHaveLength(1);

	const transformerResult = splitTabs(transformerTabs!(dummyTransformerBlock));
	expect(transformerResult.generalExtras).toHaveLength(1);
	expect(transformerResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Field Map"]);

	const dummyTransformerJsBlock: BlockNode = {
		id: "transformer-2",
		type: BLOCK_TYPES.transformer,
		position: { x: 0, y: 0 },
		data: { useJs: true, js: "return input;" },
	};
	const transformerJsResult = splitTabs(transformerTabs!(dummyTransformerJsBlock));
	expect(transformerJsResult.generalExtras).toHaveLength(1);
	expect(transformerJsResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Custom JavaScript"]);

	const pushResult = splitTabs(arrayOpsTabs!(dummyArrayOpsPushBlock));
	expect(pushResult.generalExtras).toHaveLength(1);
	expect(pushResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Operation"]);

	const filterResult = splitTabs(arrayOpsTabs!(dummyArrayOpsFilterBlock));
	expect(filterResult.generalExtras).toHaveLength(1);
	expect(filterResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Operation", "Edit Conditions"]);

	const popResult = splitTabs(arrayOpsTabs!(dummyArrayOpsPopBlock));
	expect(popResult.generalExtras).toHaveLength(1);
	expect(popResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Operation"]);

	const forLoopResult = splitTabs(forLoopTabs!(dummyForLoopBlock));
	expect(forLoopResult.generalExtras).toHaveLength(1);
	expect(forLoopResult.blockTabs).toHaveLength(0);

	const foreachResult = splitTabs(foreachLoopTabs!(dummyForeachLoopBlock));
	expect(foreachResult.generalExtras).toHaveLength(1);
	expect(foreachResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Data"]);

	const foreachParamResult = splitTabs(foreachLoopTabs!(dummyForeachLoopParamBlock));
	expect(foreachParamResult.generalExtras).toHaveLength(1);
	expect(foreachParamResult.blockTabs).toHaveLength(0);
});

test("getStoredPanelWidth defaults correctly to 550px and respects 470px - 850px bounds", () => {
	const key = "test-panel-width-key-1";
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);
});

test("setStoredPanelWidth and getStoredPanelWidth persist valid custom widths within 470px-850px", () => {
	const key = "test-panel-width-key-2";
	setStoredPanelWidth(650, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(650);

	// Below min (470px) falls back to default 550px
	setStoredPanelWidth(400, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);

	// Above max (850px) falls back to default 550px
	setStoredPanelWidth(950, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);
});

test("exports close thresholds of 450px target width and 120px delta", () => {
	expect(CLOSE_WIDTH_THRESHOLD).toBe(450);
	expect(CLOSE_DELTA_THRESHOLD).toBe(120);
});

test("custom and user-defined block types fallback to customBlockSettings with a Parameters tab", () => {
	const customBlock: BlockNode = {
		id: "custom-1",
		type: "my_custom_block",
		position: { x: 0, y: 0 },
		data: { invoke: "sync" },
	};

	const tabsFn = blockSettingsTabs(customBlock.type);
	expect(tabsFn).toBeDefined();

	const result = splitTabs(tabsFn!(customBlock));
	expect(result.blockTabs.map((tab) => tab.props.name)).toEqual(["Parameters"]);
	// "Edit Implementation" is about the block itself, so it rides in General
	// alongside the name and description rather than with the call's parameters.
	expect(result.generalExtras).toHaveLength(1);
});









/**
 * Block type keys. Declared here (rather than imported from the app) so the
 * canvas package stays standalone; values must match the strings persisted on
 * blocks by the server.
 */
export const BLOCK_TYPES = {
	entrypoint: "entrypoint",
	response: "response",
	errorHandler: "error_handler",
	stickynote: "sticky_note",
	if: "if",
	forloop: "forloop",
	foreachloop: "foreachloop",
	transformer: "transformer",
	jsrunner: "jsrunner",
	setvar: "setvar",
	getvar: "getvar",
	arrayops: "arrayops",
	httprequest: "httprequest",
	httpgetheader: "httpgetheader",
	httpsetheader: "httpsetheader",
	httpgetparam: "httpgetparam",
	httpgetcookie: "httpgetcookie",
	httpsetcookie: "httpsetcookie",
	httpgetrequestbody: "httpgetrequestbody",
	db_getsingle: "db_getsingle",
	db_getall: "db_getall",
	db_insert: "db_insert",
	db_insertbulk: "db_insertbulk",
	db_update: "db_update",
	db_delete: "db_delete",
	db_native: "db_native",
	db_transaction: "db_transaction",
	consolelog: "consolelog",
	cloudLogs: "cloud_logs",
} as const;

export type BlockType = (typeof BLOCK_TYPES)[keyof typeof BLOCK_TYPES];

export const BLOCK_TYPE_LIST = Object.values(BLOCK_TYPES) as BlockType[];

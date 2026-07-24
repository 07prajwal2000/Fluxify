import { BlockTypes } from "@/types/block";

export type CatalogEntry = { type: string; label: string };
export type CatalogGroup = { group: string; blocks: CatalogEntry[] };

// Addable blocks grouped by category (mirrors the web block palette).
export const BLOCK_CATALOG: CatalogGroup[] = [
	{
		group: "Core",
		blocks: [
			{ type: BlockTypes.response, label: "Response" },
			{ type: BlockTypes.errorHandler, label: "Error Handler" },
			{ type: BlockTypes.setvar, label: "Set Variable" },
			{ type: BlockTypes.getvar, label: "Get Variable" },
			{ type: BlockTypes.transformer, label: "Transformer" },
			{ type: BlockTypes.jsrunner, label: "JS Runner" },
			{ type: BlockTypes.arrayops, label: "Array Operations" },
		],
	},
	{
		group: "Flow",
		blocks: [
			{ type: BlockTypes.if, label: "If" },
			{ type: BlockTypes.forloop, label: "For Loop" },
			{ type: BlockTypes.foreachloop, label: "Foreach Loop" },
		],
	},
	{
		group: "Database",
		blocks: [
			{ type: BlockTypes.db_getsingle, label: "Get Single Record" },
			{ type: BlockTypes.db_getall, label: "Get All Records" },
			{ type: BlockTypes.db_insert, label: "Insert New Record" },
			{ type: BlockTypes.db_insertbulk, label: "Insert Bulk Record" },
			{ type: BlockTypes.db_update, label: "Update Record(s)" },
			{ type: BlockTypes.db_delete, label: "Delete Record(s)" },
			{ type: BlockTypes.db_transaction, label: "Database Transaction" },
			{ type: BlockTypes.db_native, label: "Native Database" },
		],
	},
	{
		group: "HTTP",
		blocks: [
			{ type: BlockTypes.httprequest, label: "Http Request" },
			{ type: BlockTypes.httpgetcookie, label: "Get Cookie" },
			{ type: BlockTypes.httpsetcookie, label: "Set Cookie" },
			{ type: BlockTypes.httpgetheader, label: "Get Header" },
			{ type: BlockTypes.httpsetheader, label: "Set Header" },
			{ type: BlockTypes.httpgetparam, label: "Get Param" },
			{ type: BlockTypes.httpgetrequestbody, label: "Get Request Body" },
		],
	},
	{
		group: "Logging",
		blocks: [
			{ type: BlockTypes.consolelog, label: "Console" },
			{ type: BlockTypes.cloudLogs, label: "Cloud Log store" },
		],
	},
];

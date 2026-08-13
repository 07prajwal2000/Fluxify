import { BLOCK_TYPES, type BlockType } from "./blockTypes";
import type { HandleKind } from "./handles/handleConfig";

export type BlockDefinition = {
	/** Human readable name shown in the block header. */
	name: string;
	/** One-liner shown under the name (truncated to one line in the node). */
	description: string;
	/** Sockets this block exposes. */
	handles: HandleKind[];
	/** Optional icon tint. */
	tint?: string;
	category: "Core" | "Flow" | "Database" | "HTTP" | "Logging" | "Misc";
};

const GREEN = "var(--success)";
const VIOLET = "var(--accent)";
const RED = "var(--danger)";

/** Inbound + one outbound "next" — the shape almost every block has. */
const STD: HandleKind[] = ["target", "source"];
/** Loop-style blocks: continue after the loop, plus a body to execute. */
const LOOP: HandleKind[] = ["target", "source", "executor"];

export const BLOCK_CATALOG: Record<BlockType, BlockDefinition> = {
	[BLOCK_TYPES.entrypoint]: {
		name: "Entrypoint",
		description: "Where the request enters this route",
		handles: ["source"],
		category: "Core",
	},
	[BLOCK_TYPES.response]: {
		name: "Response",
		description: "Send a response back to the caller",
		handles: ["target"],
		category: "Core",
	},
	[BLOCK_TYPES.errorHandler]: {
		name: "Error Handler",
		description: "Runs when a block throws an error",
		handles: ["source"],
		tint: RED,
		category: "Core",
	},
	[BLOCK_TYPES.stickynote]: {
		name: "Note",
		description: "A comment for whoever reads this flow",
		handles: [],
		category: "Misc",
	},
	[BLOCK_TYPES.if]: {
		name: "If",
		description: "Branch on a condition",
		handles: ["target", "success", "failure"],
		category: "Flow",
	},
	[BLOCK_TYPES.forloop]: {
		name: "For Loop",
		description: "Repeat the body a fixed number of times",
		handles: LOOP,
		tint: GREEN,
		category: "Flow",
	},
	[BLOCK_TYPES.foreachloop]: {
		name: "Foreach Loop",
		description: "Repeat the body for every item in a list",
		handles: LOOP,
		tint: VIOLET,
		category: "Flow",
	},
	[BLOCK_TYPES.transformer]: {
		name: "Transformer",
		description: "Reshape data into a new structure",
		handles: STD,
		category: "Misc",
	},
	[BLOCK_TYPES.jsrunner]: {
		name: "JS Runner",
		description: "Run custom JavaScript",
		handles: STD,
		category: "Misc",
	},
	[BLOCK_TYPES.setvar]: {
		name: "Set Variable",
		description: "Store a value for later blocks",
		handles: STD,
		tint: VIOLET,
		category: "Core",
	},
	[BLOCK_TYPES.getvar]: {
		name: "Get Variable",
		description: "Read a previously stored value",
		handles: STD,
		tint: GREEN,
		category: "Core",
	},
	[BLOCK_TYPES.arrayops]: {
		name: "Array Operations",
		description: "Map, filter, sort and slice lists",
		handles: STD,
		category: "Core",
	},
	[BLOCK_TYPES.httprequest]: {
		name: "Http Request",
		description: "Call an external HTTP endpoint",
		handles: STD,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpgetheader]: {
		name: "Get Header",
		description: "Read a header from the request",
		handles: STD,
		tint: GREEN,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpsetheader]: {
		name: "Set Header",
		description: "Set a header on the response",
		handles: STD,
		tint: VIOLET,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpgetparam]: {
		name: "Get Param",
		description: "Read a path or query parameter",
		handles: STD,
		tint: GREEN,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpgetcookie]: {
		name: "Get Cookie",
		description: "Read a cookie from the request",
		handles: STD,
		tint: GREEN,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpsetcookie]: {
		name: "Set Cookie",
		description: "Set a cookie on the response",
		handles: STD,
		tint: VIOLET,
		category: "HTTP",
	},
	[BLOCK_TYPES.httpgetrequestbody]: {
		name: "Get Request Body",
		description: "Read the incoming request body",
		handles: STD,
		tint: GREEN,
		category: "HTTP",
	},
	[BLOCK_TYPES.db_getsingle]: {
		name: "Get Single Record",
		description: "Fetch one row matching a filter",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_getall]: {
		name: "Get All Records",
		description: "Fetch every row matching a filter",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_insert]: {
		name: "Insert New Record",
		description: "Insert a single row",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_insertbulk]: {
		name: "Insert Bulk Records",
		description: "Insert many rows at once",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_update]: {
		name: "Update Record(s)",
		description: "Update rows matching a filter",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_delete]: {
		name: "Delete Record(s)",
		description: "Delete rows matching a filter",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_native]: {
		name: "Native Database",
		description: "Run a raw query against the database",
		handles: STD,
		category: "Database",
	},
	[BLOCK_TYPES.db_transaction]: {
		name: "Database Transaction",
		description: "Run the body in one transaction",
		handles: LOOP,
		tint: GREEN,
		category: "Database",
	},
	[BLOCK_TYPES.consolelog]: {
		name: "Console",
		description: "Print a value to the console",
		handles: STD,
		category: "Logging",
	},
	[BLOCK_TYPES.cloudLogs]: {
		name: "Cloud Log Store",
		description: "Ship a log line to the cloud store",
		handles: STD,
		category: "Logging",
	},
};

export function blockCatalogEntries(): [BlockType, BlockDefinition][] {
	return Object.entries(BLOCK_CATALOG) as [BlockType, BlockDefinition][];
}

/** Route-owned blocks are created by the route, never by the canvas picker. */
const ROUTE_OWNED_BLOCK_TYPES = new Set<BlockType>([
	BLOCK_TYPES.entrypoint,
	BLOCK_TYPES.errorHandler,
]);

/** Notes have their own quick action beside the picker trigger. */
const CANVAS_QUICK_ACTION_BLOCK_TYPES = new Set<BlockType>([
	BLOCK_TYPES.stickynote,
]);

export function canAddBlock(type: BlockType): boolean {
	return !ROUTE_OWNED_BLOCK_TYPES.has(type);
}

export function canPickBlock(type: BlockType): boolean {
	return canAddBlock(type) && !CANVAS_QUICK_ACTION_BLOCK_TYPES.has(type);
}

export function pickerBlockCatalogEntries(): [BlockType, BlockDefinition][] {
	return blockCatalogEntries().filter(([type]) => canPickBlock(type));
}

/** Definition for any type, including unknown/custom ones. */
export function blockDefinition(type: string): BlockDefinition {
	return (
		BLOCK_CATALOG[type as BlockType] ?? {
			name: type,
			description: "Custom block",
			handles: STD,
			category: "Misc",
		}
	);
}

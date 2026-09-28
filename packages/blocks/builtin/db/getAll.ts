import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { emitSort, emitWhereConditions } from "./emitConditions";
import {
	adapterFor,
	type DbSortEntry,
	dbFailure,
	dbSortSchema,
	dbWhereConditionsDescription,
	joinSchema,
	whereConditionSchema,
} from "./schema";

export const getAllDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
		joins: z.array(joinSchema).default([]).optional().describe("list of joins"),
		columns: z
			.array(z.string())
			.default(["*"])
			.optional()
			.describe(
				"list of columns to select with aliases if any (e.g. column1 or table.column2 AS column2 or table.*)",
			),
		limit: z
			.int()
			.or(z.string())
			.or(z.null())
			.default(1000)
			.describe("max rows; -1 or null for no limit (supports js expressions)"),
		offset: z
			.int()
			.or(z.string())
			.default(0)
			.describe("skip count, offset paging only (supports js expressions)"),
		sort: dbSortSchema,
		paging: z
			.enum(["offset", "cursor"])
			.default("offset")
			.describe("cursor: returns { rows, nextCursor }; pass nextCursor back as after"),
		after: z
			.string()
			.optional()
			.describe("cursor paging: the previous page's nextCursor, empty for the first page"),
		keys: z
			.array(z.string())
			.default([])
			.optional()
			.describe("cursor paging: tiebreaker columns, unique together; empty means the primary key"),
	})
	.extend(baseBlockDataSchema.shape);

export const getAllDbAiDescription = {
	name: BlockTypes.db_getall,
	description: "Retrieves multiple records from a database table.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getAllDbBlockSchema)),
};

/** limit as the block takes it: unset is 1000, -1 or null is no limit */
export function pageLimit(value: unknown): number | null {
	if (value === undefined || value === "") return 1000;
	if (value === null) return null;
	const n = typeof value === "string" ? Number(value) : value;
	if (n === -1) return null;
	if (typeof n === "number" && Number.isInteger(n) && n >= 1) return n;
	throw new Error(
		`limit must be a whole number ≥ 1, or -1 for no limit, got ${JSON.stringify(value)}`,
	);
}

/** offset as the block takes it: unset is 0 */
export function pageOffset(value: unknown): number {
	if (value === undefined || value === null || value === "") return 0;
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n;
	throw new Error(`offset must be a whole number ≥ 0, got ${JSON.stringify(value)}`);
}

type GetAllOptions = {
	joins: any[];
	columns: string[];
	paging?: "offset" | "cursor";
	after?: unknown;
	keys?: string[];
};

export async function runGetAllDb(
	context: Context,
	connection: string,
	tableName: string,
	conditions: z.infer<typeof whereConditionSchema>[],
	limit: unknown,
	offset: unknown,
	sort: DbSortEntry[],
	{ paging, after, keys, ...options }: GetAllOptions,
) {
	const rows = pageLimit(limit);
	if (after !== undefined && after !== null && typeof after !== "string") {
		throw new Error(`after must be the nextCursor text of the previous page, got ${typeof after}`);
	}
	// cursor paging never skips by count, so offset isn't read at all
	const skip = paging === "cursor" ? 0 : pageOffset(offset);
	try {
		const adapter = adapterFor(context, connection);
		if (paging === "cursor") {
			return await adapter.getPage(tableName, conditions, rows, sort, { after, keys }, options);
		}
		return await adapter.getAll(tableName, conditions, rows, skip, sort, options);
	} catch (error) {
		dbFailure("get all", error);
	}
}

export function emitGetAllDb(node: EmitNode) {
	const input = getAllDbBlockSchema.parse(node.block.data);
	return `${node.in} = await lib.dbGetAll(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)}, ${node.value(input.limit)}, ${node.value(input.offset)}, ${emitSort(input.sort, node)}, { joins: ${JSON.stringify(input.joins ?? [])}, columns: ${JSON.stringify(input.columns ?? ["*"])}${cursorOptions(input, node)} });
${node.next()}`;
}

function cursorOptions(input: z.infer<typeof getAllDbBlockSchema>, node: EmitNode) {
	if (input.paging !== "cursor") return "";
	const keys = (input.keys ?? []).map((key) => node.value(key)).join(", ");
	return `, paging: "cursor", after: ${node.value(input.after)}, keys: [${keys}]`;
}

import z from "zod";
import {
	baseBlockDataSchema,
	BaseBlock,
	BlockOutput,
	Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import {
	adapterFor,
	dbFailure,
	emitWhereConditions,
	joinSchema,
	whereConditionSchema,
} from "./schema";
import { ConditionEvaluator } from "../conditionEvaluator";
import type { EmitNode } from "../../compiler";

export const getAllDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe("list of conditions"),
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
			.default(1000)
			.describe("limit (supports js expressions)"),
		offset: z
			.int()
			.or(z.string())
			.default(0)
			.describe("skip count (supports js expressions)"),
		sort: z
			.object({
				attribute: z.string().describe("sort attribute"),
				direction: z.enum(["asc", "desc"]).describe("type of sort"),
			})
			.default({
				attribute: "id",
				direction: "asc",
			}),
	})
	.extend(baseBlockDataSchema.shape);

export const getAllDbAiDescription = {
	name: "db_get_all",
	description: "Retrieves multiple records from a database table.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getAllDbBlockSchema)),
};

export async function runGetAllDb(
	context: Context,
	connection: string,
	tableName: string,
	conditions: z.infer<typeof whereConditionSchema>[],
	limit: number,
	offset: number,
	sort: { attribute: string; direction: "asc" | "desc" },
	options: { joins: any[]; columns: string[] },
) {
	try {
		return await adapterFor(context, connection).getAll(
			tableName,
			conditions,
			limit,
			offset,
			sort,
			options,
		);
	} catch (error) {
		dbFailure("get all", error);
	}
}

export function emitGetAllDb(node: EmitNode) {
	const input = getAllDbBlockSchema.parse(node.block.data);
	const sort = `{ attribute: ${node.value(input.sort.attribute)}, direction: ${JSON.stringify(input.sort.direction)} }`;
	return `${node.in} = await lib.dbGetAll(ctx, ${JSON.stringify(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)}, lib.num(${node.value(input.limit)}, 1000), lib.num(${node.value(input.offset)}, 0), ${sort}, { joins: ${JSON.stringify(input.joins ?? [])}, columns: ${JSON.stringify(input.columns ?? ["*"])} });
${node.next()}`;
}

export class GetAllDbBlock extends BaseBlock {
	constructor(
		protected readonly context: Context,
		private readonly dbAdapter: IDbAdapter,
		protected readonly input: z.infer<typeof getAllDbBlockSchema>,
		public readonly next?: string,
	) {
		super(context, input, next);
	}

	public async executeAsync(): Promise<BlockOutput> {
		try {
			this.input.tableName = this.input.tableName.startsWith("js:")
				? ((await this.context.vm.runAsync(
						this.input.tableName.slice(3),
					)) as string)
				: this.input.tableName;
			this.input.sort.attribute = this.input.sort.attribute.startsWith("js:")
				? ((await this.context.vm.runAsync(
						this.input.sort.attribute.slice(3),
					)) as string)
				: this.input.sort.attribute;
			let limit =
				typeof this.input.limit === "string" &&
				this.input.limit.startsWith("js:")
					? Number(await this.context.vm.runAsync(this.input.limit.slice(3)))
					: Number(this.input.limit);
			let offset =
				typeof this.input.offset === "string" &&
				this.input.offset.startsWith("js:")
					? Number(await this.context.vm.runAsync(this.input.offset.slice(3)))
					: Number(this.input.offset);
			const columns = this.input.columns ?? ["*"];
			const joins = this.input.joins ?? [];
			offset = isNaN(offset) ? 0 : offset;
			limit = isNaN(limit) ? 1000 : limit;
			const evaluatedConditions = await Promise.all(
				this.input.conditions.map(async (condition) => {
					const { lhs, rhs } = await ConditionEvaluator.evaluateScript(
						condition.attribute,
						condition.value,
						this.context.vm,
					);
					return {
						...condition,
						attribute: lhs,
						value: rhs,
					};
				}),
			);
			const result = await this.dbAdapter.getAll(
				this.input.tableName,
				evaluatedConditions,
				limit,
				offset,
				this.input.sort ?? {
					attribute: "id",
					direction: "asc",
				},
				{ joins, columns },
			);
			return {
				continueIfFail: false,
				successful: true,
				output: result,
				next: this.next,
			};
		} catch (e) {
			return {
				continueIfFail: false,
				successful: false,
				error: "failed to execute get all db block",
			};
		}
	}
}

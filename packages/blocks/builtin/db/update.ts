import { BlockTypes } from "../../blockTypes";
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
	dbWhereConditionsDescription,
	whereConditionSchema,
} from "./schema";
import { emitWhereConditions } from "./emitConditions";
import { ConditionEvaluator } from "../conditionEvaluator";
import { logger } from "@fluxify/common";
import { emitJsObject, type EmitNode } from "../../compiler";

export const updateDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
		data: z.object({
			source: z.enum(["raw", "js"]).describe("source of the value"),
			value: z
				.object()
				.or(
					z
						.string()
						.describe(
							"value to insert (object values can be js expression as string)",
						),
				),
		}),
		useParam: z.boolean().describe("use parameter"),
	})
	.extend(baseBlockDataSchema.shape);

export const updateDbAiDescription = {
	name: BlockTypes.db_update,
	description:
		"Updates records in a database table matching specific conditions.",
	jsonSchema: JSON.stringify(z.toJSONSchema(updateDbBlockSchema)),
};

export async function runUpdateDb(
	context: Context,
	connection: string,
	tableName: string,
	data: object,
	conditions: z.infer<typeof whereConditionSchema>[],
) {
	try {
		return await adapterFor(context, connection).update(
			tableName,
			data,
			conditions,
		);
	} catch (error) {
		dbFailure("update", error);
	}
}

/** read without parsing — `data.value` is `z.object()`, which strips every key */
export function emitUpdateDb(node: EmitNode) {
	const input = node.block.data as z.infer<typeof updateDbBlockSchema>;
	const data = node.v("data");
	const value = input.data.value;

	let payload: string;
	if (input.useParam) {
		payload = node.in;
	} else if (input.data.source === "js" && typeof value === "string") {
		payload = node.js(value, node.in);
	} else {
		payload = emitJsObject(value, node);
	}

	return `const ${data} = ${payload};
if (typeof ${data} !== "object") throw new Error("error in update: data to update is not an object");
${node.in} = await lib.dbUpdate(ctx, ${JSON.stringify(input.connection)}, ${node.value(input.tableName)}, ${data}, ${emitWhereConditions(input.conditions, node)});
${node.next()}`;
}

export class UpdateDbBlock extends BaseBlock {
	constructor(
		protected readonly context: Context,
		private readonly dbAdapter: IDbAdapter,
		protected readonly input: z.infer<typeof updateDbBlockSchema>,
		public readonly next?: string,
	) {
		super(context, input, next);
	}

	public async executeAsync(data: object): Promise<BlockOutput> {
		try {
			let dataToUpdate = this.input.useParam ? data : this.input.data.value;
			if (
				!this.input.useParam &&
				this.input.data.source === "js" &&
				typeof this.input.data.value === "string"
			) {
				dataToUpdate = (await this.context.vm.runAsync(
					this.input.data.value,
				)) as object;
			}
			if (!(typeof dataToUpdate === "object")) {
				return {
					continueIfFail: false,
					successful: false,
					error: "error in update: data to update is not an object",
				};
			}
			dataToUpdate = await this.evaluateJsInData(dataToUpdate);
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
			this.input.tableName = this.input.tableName.startsWith("js:")
				? ((await this.context.vm.runAsync(
						this.input.tableName.slice(3),
					)) as string)
				: this.input.tableName;
			const result = await this.dbAdapter.update(
				this.input.tableName,
				dataToUpdate,
				evaluatedConditions,
			);
			return {
				continueIfFail: false,
				successful: true,
				output: result,
				next: this.next,
			};
		} catch (e) {
			logger.error("Failed to execute update db block", "BLOCKS.update", { error: e });
			return {
				continueIfFail: false,
				successful: false,
				error: "failed to execute update db block",
			};
		}
	}
	private async evaluateJsInData(data: any): Promise<any> {
		const result: any = {};
		for (const key in data) {
			const value = data[key];
			if (typeof value === "string" && value.startsWith("js:")) {
				result[key] = await this.context.vm.runAsync(value.slice(3));
			} else if (typeof value === "object") {
				result[key] = await this.evaluateJsInData(value);
			} else if (Array.isArray(value)) {
				result[key] = await this.evaluateJsInArray(value);
			} else {
				result[key] = value;
			}
		}
		return result;
	}
	private async evaluateJsInArray(data: any[]): Promise<any[]> {
		const result: any[] = [];
		for (const item of data) {
			if (typeof item === "string" && item.startsWith("js:")) {
				result.push(await this.context.vm.runAsync(item.slice(3)));
			} else if (typeof item === "object") {
				result.push(await this.evaluateJsInData(item));
			} else if (Array.isArray(item)) {
				result.push(await this.evaluateJsInArray(item));
			} else {
				result.push(item);
			}
		}
		return result;
	}
}

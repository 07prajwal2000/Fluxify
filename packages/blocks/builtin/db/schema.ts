import { operatorSchema } from "@fluxify/lib";
import z from "zod";

export const whereConditionSchema = z.object({
	attribute: z.string().describe("column name / attribute name"),
	operator: operatorSchema
		.exclude(["js", "is_empty", "is_not_empty"])
		.describe("operator for comparison"),
	value: z.string().or(z.number()).describe("value"),
	chain: z.enum(["and", "or"]).describe("conditional chain"),
});

export const joinSchema = z.object({
	table: z.string().describe("table to join"),
	alias: z.string().optional().describe("alias for the table"),
	attribute: z
		.string()
		.describe("attribute to join e.g. table1.id = table2.id")
		.refine((val) => {
			const parts = val.split("=");
			return parts.length === 2;
		}, "attribute must be in the format of table1.id = table2.id"),
	type: z
		.enum(["inner", "left", "right", "outer"])
		.default("inner")
		.describe("type of join"),
});

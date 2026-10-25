import type { z } from "zod";
import type { SchemaPropertyZod, ValidationSchemaZod } from "./validationSchemaZod";

// browser-safe (no node imports): the portal can preview what the server will store
type Property = z.infer<typeof SchemaPropertyZod>;
type Schema = z.infer<typeof ValidationSchemaZod>;
type Kind = "str" | "int" | "float" | "bool" | "object" | "arr";

/** a sample past this many array items adds nothing a hundred did not */
const MAX_ITEMS = 100;
const MAX_DEPTH = 20;

const kindOf = (value: unknown): Kind => {
	if (typeof value === "string") return "str";
	if (typeof value === "boolean") return "bool";
	if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
	return Array.isArray(value) ? "arr" : "object";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** One node from every value seen at the same position (array items, or a key across items). */
function inferNode(values: unknown[], depth: number): Schema {
	const present = values.filter((v) => v !== null && v !== undefined);
	// ponytail: a field that is only ever null has no type to learn; str is a placeholder the user edits
	if (!present.length) return { dataType: "str" };
	const byKind = new Map<Kind, unknown[]>();
	for (const v of present) {
		const kind = kindOf(v);
		byKind.set(kind, [...(byKind.get(kind) ?? []), v]);
	}
	// int and float seen together are one number: float
	if (byKind.has("int") && byKind.has("float")) {
		byKind.set("float", [...byKind.get("float")!, ...byKind.get("int")!]);
		byKind.delete("int");
	}
	const [[first, firstValues], ...rest] = [...byKind];
	const node = build(first!, firstValues!, depth);
	// ponytail: a union is the first kind plus an `or` chain of the others; nothing enforces chain yet
	if (rest.length) {
		node.chain = [
			{
				chainType: "or",
				properties: rest.map(([kind, vs]) => ({
					key: kind,
					dataType: kind,
					...pick(build(kind, vs, depth)),
				})),
			},
		];
	}
	return node;
}

const pick = ({ properties, items }: Schema) => ({
	...(properties && { properties }),
	...(items && { items }),
});

function build(kind: Kind, values: unknown[], depth: number): Schema {
	if (depth >= MAX_DEPTH || (kind !== "object" && kind !== "arr")) return { dataType: kind };
	if (kind === "arr") {
		const items = (values as unknown[][]).flatMap((a) => a.slice(0, MAX_ITEMS));
		// an empty array teaches nothing about its items
		if (!items.length) return { dataType: "arr" };
		return { dataType: "arr", items: { key: "item", ...inferNode(items, depth + 1) } as Property };
	}
	const objects = values.filter(isRecord);
	const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
	return {
		dataType: "object",
		properties: keys.map((key) => {
			const seen = objects.filter((o) => o[key] !== undefined && o[key] !== null);
			return {
				key,
				...inferNode(
					objects.map((o) => o[key]),
					depth + 1,
				),
				// required only when every sample has it with a value
				required: seen.length === objects.length,
			} as Property;
		}),
	};
}

/**
 * Infers a schema in the schema editor's format from a parsed JSON value. Types
 * only: no rules, enums or defaults, those are the user's to add.
 *
 * Arrays merge up to 100 items: a key in every item is required, a key in some
 * is optional, and a position holding different types is a union (first type +
 * an `or` chain). `null` and a missing key both read as absent.
 */
export function inferSchema(value: unknown): Schema {
	return inferNode([value], 0);
}
